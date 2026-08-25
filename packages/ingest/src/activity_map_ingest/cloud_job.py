from __future__ import annotations

import json
import mimetypes
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import boto3

from .compiler import CompileOptions, compile_strava
from .dataset_builds import rebuild_derived_dataset, versioned_manifest
from .schema import SCHEMA_VERSION


def required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing {name}")
    return value


def default_build_id() -> str:
    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    return f"schema-{SCHEMA_VERSION}-{timestamp}"


def download_dataset(s3: Any, bucket: str, prefix: str, target: Path) -> None:
    manifest_path = target / "dataset.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    source_prefix = prefix.rstrip("/")
    s3.download_file(bucket, f"{source_prefix}/dataset.json", str(manifest_path))
    manifest = json.loads(manifest_path.read_text())
    for entry in manifest.get("shards", []):
        destination = target / entry["path"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        s3.download_file(bucket, f"{source_prefix}/{entry['path']}", str(destination))
    try:
        s3.download_file(
            bucket, f"{source_prefix}/rejections.parquet", str(target / "rejections.parquet")
        )
    except Exception as error:
        if "404" not in str(error) and "HeadObject" not in str(error):
            raise


def publish_build(
    dynamo: Any,
    s3: Any,
    *,
    table_name: str,
    bucket: str,
    dataset_id: str,
    build_id: str,
    output: Path,
    subject: str | None,
) -> tuple[dict[str, Any], int]:
    manifest = json.loads((output / "dataset.json").read_text())
    published = versioned_manifest(manifest, build_id)
    prefix = f"datasets/{dataset_id}/"
    build_prefix = f"{prefix}builds/{build_id}/"
    curated_bytes = 0
    for file in output.rglob("*"):
        if not file.is_file() or file.name == "dataset.json":
            continue
        curated_bytes += file.stat().st_size
        s3.upload_file(
            str(file),
            bucket,
            build_prefix + file.relative_to(output).as_posix(),
            ExtraArgs={
                "ContentType": mimetypes.guess_type(file.name)[0] or "application/octet-stream",
                "CacheControl": "public,max-age=31536000,immutable",
            },
        )
    manifest_bytes = (json.dumps(published, indent=2) + "\n").encode()
    for key, cache_control in (
        (f"{build_prefix}dataset.json", "public,max-age=31536000,immutable"),
        (f"{prefix}dataset.json", "no-cache,no-store,must-revalidate"),
    ):
        s3.put_object(
            Bucket=bucket,
            Key=key,
            Body=manifest_bytes,
            ContentType="application/json",
            CacheControl=cache_control,
        )
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    meta_key = {"PK": {"S": f"DATASET#{dataset_id}"}, "SK": {"S": "META"}}
    current = dynamo.get_item(TableName=table_name, Key=meta_key, ConsistentRead=True).get("Item")
    previous = current.get("activeBuild", {}).get("S") if current else None
    dynamo.put_item(
        TableName=table_name,
        Item={
            "PK": meta_key["PK"],
            "SK": {"S": f"BUILD#{build_id}"},
            "entityType": {"S": "datasetBuild"},
            "status": {"S": "ready"},
            "datasetId": {"S": dataset_id},
            "buildId": {"S": build_id},
            "bucket": {"S": bucket},
            "schemaVersion": {"S": str(manifest["schema_version"])},
            "activityCount": {"N": str(manifest["activity_count"])},
            "byteSize": {"N": str(curated_bytes)},
            "createdAt": {"S": now},
        },
    )
    meta_item = {
        **meta_key,
        "entityType": {"S": "datasetRegistry"},
        "datasetId": {"S": dataset_id},
        "bucket": {"S": bucket},
        "activeBuild": {"S": build_id},
        "schemaVersion": {"S": str(manifest["schema_version"])},
        "activityCount": {"N": str(manifest["activity_count"])},
        "byteSize": {"N": str(curated_bytes)},
        "updatedAt": {"S": now},
    }
    if previous and previous != build_id:
        meta_item["previousBuild"] = {"S": previous}
    if subject:
        meta_item["owner"] = {"S": subject}
    dynamo.put_item(TableName=table_name, Item=meta_item)
    if subject:
        dynamo.put_item(
            TableName=table_name,
            Item={
                "PK": {"S": f"USER#{subject}"},
                "SK": {"S": f"DATASET#{dataset_id}"},
                "entityType": {"S": "dataset"},
                "status": {"S": "ready"},
                "datasetId": {"S": dataset_id},
                "activeBuild": {"S": build_id},
                "activityCount": {"N": str(manifest["activity_count"])},
                "byteSize": {"N": str(curated_bytes)},
            },
        )
    return published, curated_bytes


def main() -> None:
    mode = os.environ.get("JOB_MODE", "full")
    table_name = required("TABLE_NAME")
    data_bucket = required("DATA_BUCKET")
    dataset_id = os.environ.get("DATASET_ID") or required("UPLOAD_ID")
    build_id = os.environ.get("BUILD_ID") or default_build_id()
    subject = os.environ.get("USER_SUB")
    dynamo, s3 = boto3.client("dynamodb"), boto3.client("s3")
    status_key = (
        {
            "PK": {"S": f"USER#{required('USER_SUB')}"},
            "SK": {"S": f"UPLOAD#{required('UPLOAD_ID')}"},
        }
        if mode == "full"
        else {
            "PK": {"S": f"DATASET#{dataset_id}"},
            "SK": {"S": f"BUILD#{build_id}"},
        }
    )

    def status(
        value: str, detail: str = "", completed: int | None = None, total: int | None = None
    ) -> None:
        progress = (
            ", progressCompleted = :completed, progressTotal = :total"
            if completed is not None and total is not None
            else ""
        )
        dynamo.update_item(
            TableName=table_name,
            Key=status_key,
            UpdateExpression=(
                f"SET #status = :status, statusDetail = :detail, updatedAt = :now{progress}"
            ),
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": {"S": value},
                ":detail": {"S": detail[:500]},
                ":now": {"S": datetime.now(UTC).isoformat().replace("+00:00", "Z")},
                **(
                    {":completed": {"N": str(completed)}, ":total": {"N": str(total)}}
                    if completed is not None and total is not None
                    else {}
                ),
            },
        )

    try:
        with tempfile.TemporaryDirectory(prefix="squiggles-job-") as temporary:
            root = Path(temporary)
            output = root / "dataset"
            if mode == "derived":
                source = root / "source"
                status("downloading", "Downloading canonical GeoParquet")
                download_dataset(
                    s3,
                    required("SOURCE_BUCKET"),
                    os.environ.get("SOURCE_PREFIX", f"datasets/{dataset_id}"),
                    source,
                )
                status("compiling", "Building render pyramid from canonical GeoParquet")
                rebuild_derived_dataset(source, output)
            elif mode == "full":
                archive = root / "strava.zip"
                status("downloading")
                s3.download_file(required("SOURCE_BUCKET"), required("SOURCE_KEY"), str(archive))
                status("compiling")
                compile_strava(
                    CompileOptions(
                        archive,
                        output,
                        progress_callback=lambda completed, total: status(
                            "compiling",
                            f"{completed:,} of {total:,} activities · {completed / total:.0%}",
                            completed,
                            total,
                        ),
                    )
                )
            else:
                raise ValueError(f"unsupported job mode: {mode}")
            status("publishing", f"Publishing immutable build {build_id}")
            publish_build(
                dynamo,
                s3,
                table_name=table_name,
                bucket=data_bucket,
                dataset_id=dataset_id,
                build_id=build_id,
                output=output,
                subject=subject,
            )
            status("ready", f"Build {build_id} is active")
    except Exception as error:
        status("failed", str(error))
        raise


if __name__ == "__main__":
    main()
