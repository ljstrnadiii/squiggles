from __future__ import annotations

import math
from collections.abc import Iterable, Sequence

from shapely.geometry import LineString

RENDER_PYRAMID_VERSION = "4"
# One level per ~2 Web Mercator zooms. Around 40 degrees latitude these are
# approximately one pixel of geometric error at zooms 6, 8, 10, ..., 18.
# The final level is canonical full geometry.
RENDER_TOLERANCES_M: tuple[float | None, ...] = (
    2048.0,
    512.0,
    128.0,
    32.0,
    8.0,
    2.0,
    0.5,
    None,
)
RENDER_LEVEL_COUNT = len(RENDER_TOLERANCES_M)
MAX_RENDER_LOD = RENDER_LEVEL_COUNT - 1
_WEB_MERCATOR_RADIUS_M = 6_378_137.0
_MAX_MERCATOR_LATITUDE = 85.05112878


def _project(longitude: float, latitude: float) -> tuple[float, float]:
    latitude = max(-_MAX_MERCATOR_LATITUDE, min(_MAX_MERCATOR_LATITUDE, latitude))
    lon = math.radians(longitude)
    lat = math.radians(latitude)
    return (
        _WEB_MERCATOR_RADIUS_M * lon,
        _WEB_MERCATOR_RADIUS_M * math.log(math.tan(math.pi / 4 + lat / 2)),
    )


def _unproject(x: float, y: float) -> tuple[float, float]:
    return (
        math.degrees(x / _WEB_MERCATOR_RADIUS_M),
        math.degrees(2 * math.atan(math.exp(y / _WEB_MERCATOR_RADIUS_M)) - math.pi / 2),
    )


def simplify_coordinates_meters(
    coordinates: Iterable[Sequence[float]], tolerance_m: float | None
) -> list[list[float]]:
    points = [(float(point[0]), float(point[1])) for point in coordinates]
    if tolerance_m is None or tolerance_m <= 0 or len(points) <= 2:
        return [[longitude, latitude] for longitude, latitude in points]
    projected = LineString([_project(longitude, latitude) for longitude, latitude in points])
    simplified = projected.simplify(tolerance_m, preserve_topology=False)
    result = [_unproject(float(x), float(y)) for x, y in simplified.coords]
    # Preserve exact endpoints so every render level starts and ends at the same samples.
    result[0] = points[0]
    result[-1] = points[-1]
    return [[longitude, latitude] for longitude, latitude in result]
