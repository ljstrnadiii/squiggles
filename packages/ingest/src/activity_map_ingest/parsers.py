from __future__ import annotations

import gzip
import hashlib
import io
import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import fitdecode
import gpxpy
from lxml import etree
from shapely.geometry import LineString


@dataclass(frozen=True, slots=True)
class TrackPoint:
    longitude: float
    latitude: float
    timestamp: datetime | None = None
    elevation_m: float | None = None
    heart_rate: float | None = None
    cadence: float | None = None
    power: float | None = None


@dataclass(frozen=True, slots=True)
class CleanTrackResult:
    points: list[TrackPoint]
    dropped_jump_points: int
    dropped_elevation_points: int


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _valid(lon: Any, lat: Any) -> bool:
    return (
        isinstance(lon, (int, float))
        and isinstance(lat, (int, float))
        and -180 <= lon <= 180
        and -90 <= lat <= 90
    )


def _bytes(path: str) -> bytes:
    raw = Path(path).read_bytes()
    return gzip.decompress(raw) if path.lower().endswith(".gz") else raw


def checksum(path: str) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_track(path: str) -> list[TrackPoint]:
    lower = path.lower()
    if lower.endswith((".gpx", ".gpx.gz")):
        return _parse_gpx(_bytes(path))
    if lower.endswith((".tcx", ".tcx.gz")):
        return _parse_tcx(_bytes(path))
    if lower.endswith((".fit", ".fit.gz")):
        return _parse_fit(_bytes(path))
    raise ValueError("unsupported activity format")


def _parse_gpx(raw: bytes) -> list[TrackPoint]:
    doc = gpxpy.parse(io.StringIO(raw.decode("utf-8-sig")))
    result: list[TrackPoint] = []
    for track in doc.tracks:
        for segment in track.segments:
            for p in segment.points:
                if _valid(p.longitude, p.latitude):
                    result.append(TrackPoint(p.longitude, p.latitude, _utc(p.time), p.elevation))
    return result


def _number(node: etree._Element, name: str) -> float | None:
    values = node.xpath(f".//*[local-name()='{name}']/text()")
    try:
        return float(values[0]) if values else None
    except (TypeError, ValueError):
        return None


def _parse_tcx(raw: bytes) -> list[TrackPoint]:
    root = etree.fromstring(
        raw.lstrip(), parser=etree.XMLParser(resolve_entities=False, no_network=True)
    )
    result: list[TrackPoint] = []
    for node in root.xpath("//*[local-name()='Trackpoint']"):
        lat = _number(node, "LatitudeDegrees")
        lon = _number(node, "LongitudeDegrees")
        if not _valid(lon, lat):
            continue
        times = node.xpath("./*[local-name()='Time']/text()")
        stamp = datetime.fromisoformat(times[0].replace("Z", "+00:00")) if times else None
        assert lon is not None and lat is not None
        result.append(
            TrackPoint(
                float(lon),
                float(lat),
                _utc(stamp),
                _number(node, "AltitudeMeters"),
                _number(node, "HeartRateBpm"),
                _number(node, "Cadence"),
                _number(node, "Watts"),
            )
        )
    return result


def _merge_fit_records(messages: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    records: dict[object, dict[str, Any]] = {}
    order: list[object] = []
    untimed = 0
    for values in messages:
        timestamp = values.get("timestamp")
        key: object
        if timestamp is None:
            key = ("untimed", untimed)
            untimed += 1
        else:
            key = timestamp
        if key not in records:
            records[key] = {}
            order.append(key)
        records[key].update({name: value for name, value in values.items() if value is not None})
    return [records[key] for key in order]


def _parse_fit(raw: bytes) -> list[TrackPoint]:
    # Some FIT exporters split one logical sample across multiple record messages
    # with the same timestamp (coordinates in one, elevation/telemetry in another).
    # Merge those messages before requiring coordinates so the telemetry is not lost.
    messages: list[dict[str, Any]] = []
    result: list[TrackPoint] = []
    with fitdecode.FitReader(io.BytesIO(raw)) as reader:
        for frame in reader:
            if not isinstance(frame, fitdecode.FitDataMessage) or frame.name != "record":
                continue
            messages.append({field.name: field.value for field in frame.fields})
    for values in _merge_fit_records(messages):
        lat_raw, lon_raw = values.get("position_lat"), values.get("position_long")
        if lat_raw is None or lon_raw is None:
            continue
        lat, lon = float(lat_raw) * 180 / 2**31, float(lon_raw) * 180 / 2**31
        if _valid(lon, lat):
            result.append(
                TrackPoint(
                    lon,
                    lat,
                    _utc(values.get("timestamp")),
                    values.get("enhanced_altitude", values.get("altitude")),
                    values.get("heart_rate"),
                    values.get("cadence"),
                    values.get("power"),
                )
            )
    return result


def haversine_distance(points: list[TrackPoint]) -> float:
    total = 0.0
    for a, b in zip(points, points[1:], strict=False):
        p1, p2 = math.radians(a.latitude), math.radians(b.latitude)
        dp, dl = p2 - p1, math.radians(b.longitude - a.longitude)
        h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        total += 12_742_000 * math.asin(math.sqrt(h))
    return total


def _point_distance(a: TrackPoint, b: TrackPoint) -> float:
    return haversine_distance([a, b])


def _seconds(a: TrackPoint, b: TrackPoint) -> float | None:
    if a.timestamp is None or b.timestamp is None:
        return None
    value = (b.timestamp - a.timestamp).total_seconds()
    return value if value > 0 else None


def _implausible_leg(a: TrackPoint, b: TrackPoint) -> bool:
    distance = _point_distance(a, b)
    seconds = _seconds(a, b)
    return distance > 1_000 and (distance > 20_000 if seconds is None else distance / seconds > 80)


def clean_track(points: list[TrackPoint]) -> CleanTrackResult:
    """Remove only isolated GPS/elevation spikes while preserving raw track telemetry elsewhere."""
    if len(points) < 3:
        return CleanTrackResult(points, 0, 0)
    cleaned: list[TrackPoint] = [points[0]]
    jump_drops = 0
    elevation_drops = 0
    for previous, current, following in zip(points, points[1:], points[2:], strict=False):
        jump = (
            _implausible_leg(previous, current)
            and _implausible_leg(current, following)
            and not _implausible_leg(previous, following)
        )
        elevation_spike = False
        if all(point.elevation_m is not None for point in (previous, current, following)):
            assert previous.elevation_m is not None
            assert current.elevation_m is not None
            assert following.elevation_m is not None
            previous_elevation = float(previous.elevation_m)
            current_elevation = float(current.elevation_m)
            following_elevation = float(following.elevation_m)
            before = current_elevation - previous_elevation
            after = current_elevation - following_elevation
            seconds_before = _seconds(previous, current)
            seconds_after = _seconds(current, following)
            fast_before = abs(before) > (500 if seconds_before is None else 10 * seconds_before)
            fast_after = abs(after) > (500 if seconds_after is None else 10 * seconds_after)
            elevation_spike = (
                abs(before) > 150
                and abs(after) > 150
                and before * after > 0
                and abs(following_elevation - previous_elevation) < 100
                and fast_before
                and fast_after
            )
        if jump:
            jump_drops += 1
        elif elevation_spike:
            elevation_drops += 1
        else:
            cleaned.append(current)
    cleaned.append(points[-1])
    if len(cleaned) < 2:
        return CleanTrackResult(points, 0, 0)
    return CleanTrackResult(cleaned, jump_drops, elevation_drops)


def simplify(points: list[TrackPoint], target: int) -> list[list[float]]:
    coords = [(p.longitude, p.latitude) for p in points]
    if len(coords) <= target:
        return [[x, y] for x, y in coords]
    line = LineString(coords)
    low, high = 0.0, max(line.bounds[2] - line.bounds[0], line.bounds[3] - line.bounds[1])
    best = line
    for _ in range(20):
        tolerance = (low + high) / 2
        # LineStrings remain valid lines without polygon topology preservation. Enabling
        # it retains millions of vertices around self-crossings and defeats measured LODs.
        candidate = line.simplify(tolerance, preserve_topology=False)
        if len(candidate.coords) > target:
            low = tolerance
        else:
            best, high = candidate, tolerance
    return [[float(x), float(y)] for x, y in best.coords]
