from __future__ import annotations

from pathlib import Path

import pyarrow.parquet as pq


def canonical_locators(canonical_root: Path) -> dict[str, tuple[str, int]]:
    """Return activity_id -> (canonical dataset path, row group)."""
    locators: dict[str, tuple[str, int]] = {}
    for path in sorted(canonical_root.glob("activity_family=*/part-*.parquet")):
        relative = f"activities/{path.relative_to(canonical_root).as_posix()}"
        parquet = pq.ParquetFile(path)
        for row_group in range(parquet.num_row_groups):
            ids = parquet.read_row_group(row_group, columns=["activity_id"])["activity_id"].to_pylist()
            for activity_id in ids:
                key = str(activity_id)
                if key in locators:
                    raise ValueError(f"duplicate canonical activity_id: {key}")
                locators[key] = (relative, row_group)
    return locators
