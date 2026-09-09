from __future__ import annotations

import os
from typing import Any

from botocore.exceptions import ClientError


ARCHIVE_READY_SUBJECT = "Your Squiggles archive is ready"
ARCHIVE_READY_BODY = "\n".join(
    [
        "Your activity archive has finished optimizing and is ready to explore in Squiggles.",
        "",
        "This is the last automated email Squiggles sends. We do not send marketing or engagement email.",
    ]
)


def send_archive_ready_email(
    dynamo: Any,
    ses: Any,
    *,
    table_name: str,
    subject: str,
) -> bool:
    key = {"PK": {"S": f"USER#{subject}"}, "SK": {"S": "PROFILE"}}
    profile = dynamo.get_item(TableName=table_name, Key=key, ConsistentRead=True).get("Item")
    email = profile.get("email", {}).get("S") if profile else None
    if not email:
        return False

    marker = "archiveReadyEmailSentAt"
    try:
        dynamo.update_item(
            TableName=table_name,
            Key=key,
            ConditionExpression="attribute_not_exists(#marker)",
            UpdateExpression="SET #marker = :now",
            ExpressionAttributeNames={"#marker": marker},
            ExpressionAttributeValues={":now": {"S": __import__("datetime").datetime.now(__import__("datetime").UTC).isoformat().replace("+00:00", "Z")}},
        )
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False
        raise

    try:
        ses.send_email(
            FromEmailAddress=os.environ.get("NOTIFICATION_FROM_EMAIL", "notifications@squiggles.io"),
            Destination={"ToAddresses": [email]},
            Content={
                "Simple": {
                    "Subject": {"Data": ARCHIVE_READY_SUBJECT, "Charset": "UTF-8"},
                    "Body": {"Text": {"Data": ARCHIVE_READY_BODY, "Charset": "UTF-8"}},
                }
            },
        )
        return True
    except Exception:
        try:
            dynamo.update_item(
                TableName=table_name,
                Key=key,
                UpdateExpression="REMOVE #marker",
                ExpressionAttributeNames={"#marker": marker},
            )
        except Exception:
            pass
        raise
