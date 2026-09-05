from __future__ import annotations

import json
import os
import subprocess
import time
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


def wait_for_jobs(job_ids: list[str], poll_seconds: int = 20) -> None:
    remaining = set(job_ids)
    while remaining:
        failed: list[dict[str, Any]] = []
        completed: set[str] = set()
        ids = list(remaining)
        for offset in range(0, len(ids), 100):
            page = aws("batch", "describe-jobs", "--jobs", *ids[offset : offset + 100])
            for job in page.get("jobs", []):
                status = job.get("status")
                if status == "SUCCEEDED":
                    completed.add(job["jobId"])
                elif status == "FAILED":
                    failed.append(job)
        if failed:
            details = "; ".join(
                f"{job.get('jobName', job.get('jobId'))}: {job.get('statusReason', 'failed')}"
                for job in failed
            )
            raise RuntimeError(f"render rebuild failed: {details}")
        remaining -= completed
        if remaining:
            print(f"Waiting for {len(remaining)} render rebuild job(s)...")
            time.sleep(poll_seconds)


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
    jobs: list[str] = []
    for item in stale:
        dataset_id = value(item, "datasetId")
        bucket = value(item, "bucket")
        if not dataset_id or not bucket:
            raise RuntimeError("dataset registry row is missing datasetId or bucket")
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
        submitted = aws(
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
        job_id = submitted.get("jobId")
        if not job_id:
            raise RuntimeError(f"Batch did not return a job ID for dataset {dataset_id}")
        jobs.append(job_id)
        print(f"Submitted {dataset_id} -> {build_id} ({job_id})")

    print(f"Waiting for {len(jobs)} stale dataset render rebuild(s) to finish.")
    wait_for_jobs(jobs)
    print(f"All datasets now use render pyramid v{render_version}.")


if __name__ == "__main__":
    main()
