#!/usr/bin/env python3
"""Rebuild and roll back every hosted Squiggles dataset through AWS Batch."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import UTC, datetime
from typing import Any

DATASET_ID = re.compile(r"^[0-9a-f-]{36}$")


def aws(arguments: list[str], profile: str) -> dict[str, Any]:
    command = ["aws", *arguments, "--profile", profile, "--output", "json", "--no-cli-pager"]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return json.loads(result.stdout or "{}")


def aws_text(arguments: list[str], profile: str) -> str:
    command = ["aws", *arguments, "--profile", profile, "--no-cli-pager"]
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout


def aws_stdin(arguments: list[str], profile: str, payload: str) -> None:
    command = ["aws", *arguments, "--profile", profile, "--no-cli-pager"]
    subprocess.run(command, input=payload, check=True, text=True)


def one(values: list[str], name: str, override: str | None) -> str:
    if override:
        return override
    if len(values) != 1:
        raise SystemExit(
            f"Expected one {name}, found {', '.join(values) or 'none'}; pass --{name}."
        )
    return values[0]


def resources(args: argparse.Namespace) -> tuple[str, str, str, list[str]]:
    tables = aws(["dynamodb", "list-tables"], args.profile).get("TableNames", [])
    table = one([name for name in tables if name.startswith("control-plane-")], "table", args.table)
    queues = aws(["batch", "describe-job-queues", "--region", args.region], args.profile).get(
        "jobQueues", []
    )
    queue = one(
        [item["jobQueueArn"] for item in queues if item["jobQueueName"].startswith("ingest-")],
        "queue",
        args.queue,
    )
    definitions = aws(
        ["batch", "describe-job-definitions", "--status", "ACTIVE", "--region", args.region],
        args.profile,
    ).get("jobDefinitions", [])
    candidates = [item for item in definitions if item["jobDefinitionName"].startswith("ingest-")]
    if args.job_definition:
        definition = args.job_definition
    elif not candidates:
        raise SystemExit("No active Squiggles job definition found.")
    else:
        definition = max(candidates, key=lambda item: item["revision"])["jobDefinitionArn"]
    bucket_names = [
        item["Name"] for item in aws(["s3api", "list-buckets"], args.profile)["Buckets"]
    ]
    buckets = args.bucket or [
        name for name in bucket_names if name.startswith(("data-", "ingested-"))
    ]
    return table, queue, definition, buckets


def datasets(buckets: list[str], profile: str) -> list[dict[str, Any]]:
    found = []
    for bucket in buckets:
        page = aws(
            [
                "s3api",
                "list-objects-v2",
                "--bucket",
                bucket,
                "--prefix",
                "datasets/",
                "--delimiter",
                "/",
            ],
            profile,
        )
        for entry in page.get("CommonPrefixes", []):
            dataset_id = entry["Prefix"].removeprefix("datasets/").removesuffix("/")
            if not DATASET_ID.fullmatch(dataset_id):
                continue
            manifest = json.loads(
                aws_text(
                    [
                        "s3",
                        "cp",
                        f"s3://{bucket}/datasets/{dataset_id}/dataset.json",
                        "-",
                        "--no-progress",
                    ],
                    profile,
                )
            )
            found.append(
                {
                    "bucket": bucket,
                    "id": dataset_id,
                    "schema": manifest.get("schema_version", "unknown"),
                    "build": manifest.get("build", {}).get("id"),
                    "activities": manifest.get("activity_count", 0),
                }
            )
    return found


def submit_rebuild(
    item: dict[str, Any],
    build_id: str,
    table: str,
    queue: str,
    definition: str,
    args: argparse.Namespace,
) -> str:
    environment = [
        {"name": "JOB_MODE", "value": "derived"},
        {"name": "TABLE_NAME", "value": table},
        {"name": "SOURCE_BUCKET", "value": item["bucket"]},
        {"name": "SOURCE_PREFIX", "value": f"datasets/{item['id']}"},
        {"name": "DATA_BUCKET", "value": item["bucket"]},
        {"name": "DATASET_ID", "value": item["id"]},
        {"name": "BUILD_ID", "value": build_id},
    ]
    result = aws(
        [
            "batch",
            "submit-job",
            "--region",
            args.region,
            "--job-name",
            f"rebuild-{item['id'][:8]}-{build_id[-14:]}",
            "--job-queue",
            queue,
            "--job-definition",
            definition,
            "--container-overrides",
            json.dumps({"environment": environment}),
        ],
        args.profile,
    )
    return result["jobId"]


def rollback(item: dict[str, Any], build_id: str, table: str, args: argparse.Namespace) -> None:
    bucket, dataset_id = item["bucket"], item["id"]
    manifest = aws_text(
        [
            "s3",
            "cp",
            f"s3://{bucket}/datasets/{dataset_id}/builds/{build_id}/dataset.json",
            "-",
            "--no-progress",
        ],
        args.profile,
    )
    aws_stdin(
        [
            "s3",
            "cp",
            "-",
            f"s3://{bucket}/datasets/{dataset_id}/dataset.json",
            "--content-type",
            "application/json",
            "--cache-control",
            "no-cache,no-store,must-revalidate",
            "--no-progress",
        ],
        args.profile,
        manifest,
    )
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    aws(
        [
            "dynamodb",
            "update-item",
            "--table-name",
            table,
            "--key",
            json.dumps({"PK": {"S": f"DATASET#{dataset_id}"}, "SK": {"S": "META"}}),
            "--update-expression",
            "SET previousBuild = activeBuild, activeBuild = :build, updatedAt = :now",
            "--expression-attribute-values",
            json.dumps({":build": {"S": build_id}, ":now": {"S": now}}),
        ],
        args.profile,
    )
    print(f"Rolled back {dataset_id} to {build_id}.")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--profile", default="squiggle-dev")
    result.add_argument("--region", default="us-west-2")
    result.add_argument("--table")
    result.add_argument("--queue")
    result.add_argument("--job-definition")
    result.add_argument("--bucket", action="append", help="Dataset bucket; repeat to include more")
    commands = result.add_subparsers(dest="command", required=True)
    commands.add_parser("list")
    rebuild = commands.add_parser("rebuild-all")
    rebuild.add_argument("--build-id")
    rebuild.add_argument("--force", action="store_true")
    single = commands.add_parser("rebuild")
    single.add_argument("dataset_id")
    single.add_argument("--build-id")
    single.add_argument("--force", action="store_true")
    rollback_parser = commands.add_parser("rollback")
    rollback_parser.add_argument("dataset_id")
    rollback_parser.add_argument("build_id")
    return result


def main() -> None:
    args = parser().parse_args()
    table, queue, definition, buckets = resources(args)
    hosted = datasets(buckets, args.profile)
    if args.command == "list":
        print("DATASET\tSCHEMA\tACTIVE BUILD\tACTIVITIES\tBUCKET")
        for item in hosted:
            print(
                f"{item['id']}\t{item['schema']}\t{item['build'] or 'legacy'}\t"
                f"{item['activities']}\t{item['bucket']}"
            )
        return
    selected = hosted
    if args.command in {"rebuild", "rollback"}:
        selected = [item for item in hosted if item["id"] == args.dataset_id]
        if len(selected) != 1:
            raise SystemExit(
                f"Expected one hosted dataset named {args.dataset_id}, found {len(selected)}."
            )
    if args.command == "rollback":
        rollback(selected[0], args.build_id, table, args)
        return
    build_id = args.build_id or f"schema-1.4.0-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}"
    submitted = 0
    for item in selected:
        if item["build"] == build_id and not args.force:
            print(f"Skipping {item['id']}; {build_id} is already active.")
            continue
        job_id = submit_rebuild(item, build_id, table, queue, definition, args)
        print(f"Queued {item['id']} as {job_id} -> {build_id}.")
        submitted += 1
    print(f"Queued {submitted} dataset rebuild(s).")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        if error.stderr:
            print(error.stderr.rstrip(), file=sys.stderr)
        raise SystemExit(error.returncode) from error
