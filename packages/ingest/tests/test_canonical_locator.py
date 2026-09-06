from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
from activity_map_ingest.canonical_locator import canonical_locators


def test_canonical_locators_include_path_and_row_group(tmp_path: Path) -> None:
    root = tmp_path / "activities"
    family = root / "activity_family=run"
    family.mkdir(parents=True)
    table = pa.table({"activity_id": ["a", "b", "c", "d"]})
    pq.write_table(table, family / "part-00000.parquet", row_group_size=2)

    assert canonical_locators(root) == {
        "a": ("activities/activity_family=run/part-00000.parquet", 0),
        "b": ("activities/activity_family=run/part-00000.parquet", 0),
        "c": ("activities/activity_family=run/part-00000.parquet", 1),
        "d": ("activities/activity_family=run/part-00000.parquet", 1),
    }
