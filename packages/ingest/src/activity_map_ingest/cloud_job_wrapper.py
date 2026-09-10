from __future__ import annotations

import logging
import os

import boto3

from .cloud_job import main as run_cloud_job
from .notifications import send_archive_ready_email

logger = logging.getLogger(__name__)


def main() -> None:
    run_cloud_job()
    if os.environ.get("JOB_MODE", "full") != "full":
        return

    subject = os.environ.get("USER_SUB")
    table_name = os.environ.get("TABLE_NAME")
    if not subject or not table_name:
        return

    try:
        send_archive_ready_email(
            boto3.client("dynamodb"),
            boto3.client("sesv2"),
            table_name=table_name,
            subject=subject,
        )
    except Exception:
        logger.exception("archive-ready lifecycle email failed")


if __name__ == "__main__":
    main()
