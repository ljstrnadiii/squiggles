from __future__ import annotations

import mimetypes
import os
import tempfile
import traceback
from pathlib import Path

import boto3

from .compiler import CompileOptions, compile_strava


def required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing {name}")
    return value


def main() -> None:
    table_name, source_bucket, source_key = (
        required("TABLE_NAME"),
        required("SOURCE_BUCKET"),
        required("SOURCE_KEY"),
    )
    data_bucket, subject, upload_id = (
        required("DATA_BUCKET"),
        required("USER_SUB"),
        required("UPLOAD_ID"),
    )
    from_email = os.environ.get("FROM_EMAIL", "")
    dynamo, s3, ses = boto3.client("dynamodb"), boto3.client("s3"), boto3.client("sesv2")
    key = {"PK": {"S": f"USER#{subject}"}, "SK": {"S": f"UPLOAD#{upload_id}"}}

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
            Key=key,
            UpdateExpression=f"SET #status = :status, statusDetail = :detail{progress}",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": {"S": value},
                ":detail": {"S": detail[:500]},
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
            archive, output = root / "strava.zip", root / "dataset"
            status("downloading")
            s3.download_file(source_bucket, source_key, str(archive))
            status("compiling")
            manifest = compile_strava(
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
            status("publishing")
            prefix = f"datasets/{upload_id}/"
            curated_bytes = 0
            for file in output.rglob("*"):
                if file.is_file():
                    curated_bytes += file.stat().st_size
                    s3.upload_file(
                        str(file),
                        data_bucket,
                        prefix + file.relative_to(output).as_posix(),
                        ExtraArgs={
                            "ContentType": mimetypes.guess_type(file.name)[0]
                            or "application/octet-stream"
                        },
                    )
            dynamo.put_item(
                TableName=table_name,
                Item={
                    "PK": key["PK"],
                    "SK": {"S": f"DATASET#{upload_id}"},
                    "entityType": {"S": "dataset"},
                    "status": {"S": "ready"},
                    "datasetId": {"S": upload_id},
                    "activityCount": {"N": str(manifest["activity_count"])},
                    "byteSize": {"N": str(curated_bytes)},
                },
            )
            status("ready")
            profile = dynamo.get_item(
                TableName=table_name,
                Key={"PK": key["PK"], "SK": {"S": "PROFILE"}},
                ConsistentRead=True,
            ).get("Item", {})
            email = profile.get("email", {}).get("S", "")
            if from_email and email:
                try:
                    ses.send_email(
                        FromEmailAddress=from_email,
                        Destination={"ToAddresses": [email]},
                        Content={
                            "Simple": {
                                "Subject": {"Data": "Your Squiggles dataset is ready"},
                                "Body": {
                                    "Text": {
                                        "Data": (
                                            "Your Strava archive has finished processing. "
                                            "Open https://squiggles.io and sign in to view "
                                            "your dataset."
                                        )
                                    }
                                },
                            }
                        },
                    )
                except Exception:
                    # A notification failure must not invalidate a curated dataset.
                    print("Dataset is ready, but its completion email could not be sent.")
                    traceback.print_exc()
    except Exception as error:
        status("failed", str(error))
        raise


if __name__ == "__main__":
    main()
