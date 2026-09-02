from __future__ import annotations

import json
import os
import subprocess
from datetime import UTC, datetime
from typing import Any


def required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing {name}")
    return value


def aws(*arguments: str) -> dict[str, Any]:
    result = subprocess.run(
        ["aws", *arguments, "--output", "json"],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout or "{}")


def registry_items(table_name: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    start_key: dict[str, Any] | None = None
    while True:
        arguments = [
            "dynamodb",
            "scan",
            "--table-name",
            table_name,
            "--filter-expression",
            "entityType = :registry",
            "--expression-attribute-values",
            json.dumps({":registry": {"S": "datasetRegistry"}}),
            "--projection-expression",
            "datasetId,activeBuild,#owner,#bucket,renderVersion",
            "--expression-attribute-names",
            json.dumps({"#owner": "owner", "#bucket": "bucket"}),
        ]
        if start_key:
            arguments.extend(["--exclusive-start-key", json.dumps(start_key)])
        page = aws(*arguments)
        items.extend(page.get("Items", []))
        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            return items


def value(item: dict[str, Any], name: str) -> str | None:
    raw = item.get(name, {})
    return raw.get("S") if isinstance(raw, dict) else None


def main() -> None:
    table_name = required("METADATA_TABLE_NAME")
    queue = required("INGEST_JOB_QUEUE")
    definition = required("INGEST_JOB_DEFINITION")
    render_version = required("RENDER_PYRAMID_VERSION")
    stale = [
        item
        for item in registry_items(table_name)
        if value(item, "renderVersion") != render_version
    ]
    if not stale:
        print(f"All datasets already use render pyramid v{render_version}.")
        return
    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    enqueued = 0
    for item in stale:
        dataset_id = value(item, "datasetId")
        bucket = value(item, "bucket")
        if not dataset_id or not bucket:
            print("Skipping registry row without datasetId/bucket")
            continue
        build_id = f"render-v{render_version}-{timestamp}-{dataset_id[:8]}"
        environment = {
            "JOB_MODE": "derived",
            "TABLE_NAME": table_name,
            "DATA_BUCKET": bucket,
            "DATASET_ID": dataset_id,
            "BUILD_ID": build_id,
            "SOURCE_BUCKET": bucket,
            "SOURCE_PREFIX": f"datasets/{dataset_id}",
        }
        owner = value(item, "owner")
        if owner:
            environment["USER_SUB"] = owner
        aws(
            "batch",
            "submit-job",
            "--job-name",
            f"render-{dataset_id[:8]}-v{render_version}",
            "--job-queue",
            queue,
            "--job-definition",
            definition,
            "--container-overrides",
            json.dumps(
                {"environment": [{"name": name, "value": val} for name, val in environment.items()]}
            ),
        )
        enqueued += 1
        print(f"Enqueued {dataset_id} -> {build_id}")
    print(f"Enqueued {enqueued} stale dataset render rebuild(s).")


if __name__ == "__main__":
    main()
