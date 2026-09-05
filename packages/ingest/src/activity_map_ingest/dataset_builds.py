from __future__ import annotations

import copy
import hashlib
import json
import re
import shutil
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from .compiler import COMPILER_VERSION, validate_dataset
from .geoparquet_sink import write_render_pyramid
from .render_lod import RENDER_PYRAMID_VERSION
from .schema import SCHEMA_VERSION

BUILD_ID = re.compile(r"^[a-z0-9][a-z0-9.-]{0,79}$")


def normalized_artifact_path(path: str, kind: str) -> str:
    marker = f"{kind}/"
    offset = path.find(marker)
    if offset < 0 or path.startswith("/") or ".." in Path(path).parts:
        raise ValueError(f"invalid {kind} artifact path: {path}")
    return path[offset:]


def versioned_manifest(manifest: dict[str, Any], build_id: str) -> dict[str, Any]:
    """Return the stable-root manifest that atomically selects one immutable build."""
    if not BUILD_ID.fullmatch(build_id):
        raise ValueError("invalid build identifier")
    result = copy.deepcopy(manifest)
    prefix = f"builds/{build_id}/"
    for entry in result.get("shards", []):
        entry["path"] = prefix + entry["path"]
    for level in result.get("render_levels", []):
        for file in level.get("files", []):
            file["path"] = prefix + file["path"]
    result["build"] = {
        "id": build_id,
        "created_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }
    return result


def rebuild_derived_dataset(
    source: Path, output: Path, progress_callback: Callable[[int, int], None] | None = None
) -> dict[str, Any]:
    """Rebuild render artifacts from canonical GeoParquet without source re-ingestion."""
    manifest = json.loads((source / "dataset.json").read_text())
    shards = manifest.get("shards", [])
    if not shards:
        raise ValueError("source manifest contains no canonical shards")
    if output.exists():
        raise FileExistsError(f"output already exists: {output}")
    output.mkdir(parents=True)
    tables = []
    normalized_shards = []
    for shard in shards:
        source_path = source / shard["path"]
        relative = normalized_artifact_path(shard["path"], "activities")
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, target)
        if hashlib.sha256(target.read_bytes()).hexdigest() != shard["sha256"]:
            raise ValueError(f"canonical shard checksum differs: {shard['path']}")
        table = pq.ParquetFile(target).read()
        # Canonical shards encode activity_family as a Hive partition rather than
        # a physical column. Restore it while deriving the render dataset.
        family = next(
            (
                part.split("=", 1)[1]
                for part in Path(relative).parts
                if part.startswith("activity_family=")
            ),
            "other",
        )
        if "activity_family" not in table.column_names:
            table = table.append_column(
                "activity_family", pa.array([family] * table.num_rows, type=pa.string())
            )
        tables.append(table)
        normalized_shards.append({**shard, "path": relative})
    rejection_source = source / "rejections.parquet"
    if rejection_source.is_file():
        shutil.copy2(rejection_source, output / "rejections.parquet")
    render_levels = write_render_pyramid(
        pa.concat_tables(tables, promote_options="default"),
        output / "render",
        progress_callback=progress_callback,
    )
    rebuilt = {
        **{key: value for key, value in manifest.items() if key not in {"build", "render_levels"}},
        "schema_version": manifest.get("schema_version", SCHEMA_VERSION),
        "compiler_version": COMPILER_VERSION,
        "render_pyramid_version": RENDER_PYRAMID_VERSION,
        "shards": normalized_shards,
        "render_levels": render_levels,
        "derived_from_schema_version": manifest.get("schema_version"),
    }
    (output / "dataset.json").write_text(json.dumps(rebuilt, indent=2) + "\n")
    validate_dataset(output)
    return rebuilt
