from __future__ import annotations

import csv
import gzip
import json
import zipfile
from pathlib import Path

import pyarrow.parquet as pq
import pytest
from activity_map_ingest.compiler import (
    CompileOptions,
    _activity_family,
    _records,
    _safe_extract,
    compile_strava,
    validate_dataset,
)
from activity_map_ingest.parsers import (
    TrackPoint,
    _merge_fit_records,
    clean_track,
    parse_track,
    simplify,
)

GPX = """<?xml version="1.0"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
<trkpt lat="40.0" lon="-105.0"><ele>1000</ele><time>2025-01-02T03:04:05Z</time></trkpt>
<trkpt lat="40.01" lon="-105.01"><ele>1010</ele><time>2025-01-02T03:05:05Z</time></trkpt>
<trkpt lat="40.02" lon="-105.02"><ele>1005</ele><time>2025-01-02T03:06:05Z</time></trkpt>
</trkseg></trk></gpx>"""

TCX = """  <?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
<Activities><Activity Sport="Running"><Lap StartTime="2025-01-02T03:04:05Z"><Track>
<Trackpoint><Time>2025-01-02T03:04:05Z</Time><Position><LatitudeDegrees>40</LatitudeDegrees><LongitudeDegrees>-105</LongitudeDegrees></Position><AltitudeMeters>1000</AltitudeMeters></Trackpoint>
<Trackpoint><Time>2025-01-02T03:05:05Z</Time><Position><LatitudeDegrees>40.01</LatitudeDegrees><LongitudeDegrees>-105.01</LongitudeDegrees></Position><AltitudeMeters>1010</AltitudeMeters></Trackpoint>
</Track></Lap></Activity></Activities></TrainingCenterDatabase>"""


def _fixture(root: Path) -> Path:
    activities = root / "activities"
    activities.mkdir(parents=True)
    (activities / "1.gpx").write_text(GPX)
    with gzip.open(activities / "2.tcx.gz", "wb") as handle:
        handle.write(TCX.encode())
    header = [
        "Activity ID",
        "Activity Date",
        "Activity Name",
        "Activity Type",
        "Elapsed Time",
        "Distance",
        "Elapsed Time",
        "Moving Time",
        "Distance",
        "Elevation Gain",
        "Filename",
    ]
    rows = [
        [
            "1",
            "Jan 02, 2025, 03:04:05 AM",
            "Morning",
            "Run",
            "120",
            "1.5",
            "120",
            "110",
            "1.5",
            "10",
            "activities/1.gpx",
        ],
        [
            "2",
            "Jan 02, 2025, 03:04:05 AM",
            "Evening",
            "Ride",
            "60",
            "1",
            "60",
            "55",
            "1",
            "5",
            "activities/2.tcx.gz",
        ],
        [
            "3",
            "Jan 02, 2025, 03:04:05 AM",
            "Missing",
            "Run",
            "60",
            "1",
            "60",
            "55",
            "1",
            "5",
            "activities/3.fit.gz",
        ],
    ]
    with (root / "activities.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)
    return root


def test_gpx_and_compressed_tcx_parse(tmp_path: Path) -> None:
    root = _fixture(tmp_path)
    assert len(parse_track(str(root / "activities/1.gpx"))) == 3
    assert len(parse_track(str(root / "activities/2.tcx.gz"))) == 2


def test_fit_records_merge_split_telemetry_by_timestamp() -> None:
    from datetime import UTC, datetime

    stamp = datetime(2025, 1, 2, tzinfo=UTC)
    records = _merge_fit_records(
        [
            {"timestamp": stamp, "position_lat": 1, "position_long": 2, "altitude": None},
            {"timestamp": stamp, "enhanced_altitude": 1234.5},
        ]
    )
    assert records == [
        {
            "timestamp": stamp,
            "position_lat": 1,
            "position_long": 2,
            "enhanced_altitude": 1234.5,
        }
    ]


def test_duplicate_headers_and_missing_file_are_normalized(tmp_path: Path) -> None:
    records, rejects = _records(_fixture(tmp_path))
    assert len(records) == 2
    assert records[0]["distance_csv"] == 1500
    assert rejects[0]["reason_code"] == "missing_file"


def test_lod_preserves_endpoints() -> None:
    points = parse_track_data()
    result = simplify(points, 2)
    assert result[0] == [-105.0, 40.0]
    assert result[-1] == [-105.02, 40.02]


def test_lod_meets_target_for_self_crossing_line() -> None:
    points = [
        TrackPoint(-105 + (index % 17) * 0.001, 40 + (index % 19) * 0.001) for index in range(500)
    ]
    result = simplify(points, 40)
    assert len(result) <= 40
    assert result[0] == [-105.0, 40.0]
    assert result[-1] == [points[-1].longitude, points[-1].latitude]


def test_activity_family_is_coarse_and_stable() -> None:
    assert _activity_family("Mountain Bike Ride") == "ride"
    assert _activity_family("Backcountry Ski") == "ski"
    assert _activity_family("Trail Run") == "run"


def test_clean_track_removes_only_isolated_spatial_and_elevation_spikes() -> None:
    from datetime import UTC, datetime, timedelta

    start = datetime(2025, 1, 1, tzinfo=UTC)
    points = [
        TrackPoint(-105, 40, start, 1000),
        TrackPoint(0, 0, start + timedelta(seconds=10), 1005),
        TrackPoint(-105.001, 40.001, start + timedelta(seconds=20), 1010),
        TrackPoint(-105.002, 40.002, start + timedelta(seconds=30), 3000),
        TrackPoint(-105.003, 40.003, start + timedelta(seconds=40), 1020),
    ]
    result = clean_track(points)
    assert result.dropped_jump_points == 1
    assert result.dropped_elevation_points == 1
    assert len(result.points) == 3


def parse_track_data() -> list[TrackPoint]:
    return [TrackPoint(-105, 40), TrackPoint(-105.01, 40.01), TrackPoint(-105.02, 40.02)]


def test_zip_traversal_is_rejected(tmp_path: Path) -> None:
    archive = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive, "w") as target:
        target.writestr("../secret", "bad")
    with pytest.raises(ValueError, match="unsafe"):
        _safe_extract(archive, tmp_path / "out")


def test_compile_validate_and_refuse_overwrite(tmp_path: Path) -> None:
    # Use Ray's local-compatible pipeline while keeping the fixture deliberately tiny.
    source, output = _fixture(tmp_path / "source"), tmp_path / "dataset"
    manifest = compile_strava(CompileOptions(source, output, batch_size=1, num_cpus=1))
    assert manifest["activity_count"] == 2
    assert manifest["rejection_count"] == 1
    assert manifest["schema_version"] == "1.3.0"
    assert all("activity_family=" in shard["path"] for shard in manifest["shards"])
    assert all("start_year=" not in shard["path"] for shard in manifest["shards"])
    assert all("start_month=" not in shard["path"] for shard in manifest["shards"])
    assert all(len(shard["bbox"]) == 4 for shard in manifest["shards"])
    assert all(shard["row_group_count"] == len(shard["row_groups"]) for shard in manifest["shards"])
    assert all(
        sum(group["row_count"] for group in shard["row_groups"]) == shard["row_count"]
        for shard in manifest["shards"]
    )
    activity_table = pq.ParquetFile(output / manifest["shards"][0]["path"]).read()
    assert activity_table["start_year"].to_pylist() == [2025]
    assert activity_table["start_month"].to_pylist() == [1]
    assert "geometry_clean_lod0" in activity_table.column_names
    assert validate_dataset(output)["activity_count"] == 2
    assert pq.read_table(output / "rejections.parquet").num_rows == 1
    assert json.loads((output / "dataset.json").read_text())["bbox"] == [
        -105.02,
        40.0,
        -105.0,
        40.02,
    ]
    with pytest.raises(FileExistsError):
        compile_strava(CompileOptions(source, output))
