from __future__ import annotations

import pytest

from activity_map_ingest.notifications import (
    ARCHIVE_READY_BODY,
    ARCHIVE_READY_SUBJECT,
    send_archive_ready_email,
)


class ConditionalError(Exception):
    response = {"Error": {"Code": "ConditionalCheckFailedException"}}


class FakeDynamo:
    def __init__(self, *, duplicate: bool = False) -> None:
        self.duplicate = duplicate
        self.updates: list[dict[str, object]] = []

    def get_item(self, **_: object) -> dict[str, object]:
        return {"Item": {"email": {"S": "runner@example.com"}}}

    def update_item(self, **kwargs: object) -> None:
        self.updates.append(kwargs)
        if self.duplicate and kwargs.get("ConditionExpression"):
            raise ConditionalError


class FakeSes:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.messages: list[dict[str, object]] = []

    def send_email(self, **kwargs: object) -> None:
        self.messages.append(kwargs)
        if self.fail:
            raise RuntimeError("ses unavailable")


def test_archive_ready_email_is_sent_once() -> None:
    dynamo = FakeDynamo()
    ses = FakeSes()

    assert send_archive_ready_email(
        dynamo, ses, table_name="metadata", subject="abc"
    ) is True
    assert len(ses.messages) == 1
    message = ses.messages[0]
    assert message["Destination"] == {"ToAddresses": ["runner@example.com"]}
    assert message["Content"] == {
        "Simple": {
            "Subject": {"Data": ARCHIVE_READY_SUBJECT, "Charset": "UTF-8"},
            "Body": {"Text": {"Data": ARCHIVE_READY_BODY, "Charset": "UTF-8"}},
        }
    }


def test_archive_ready_email_duplicate_is_suppressed() -> None:
    dynamo = FakeDynamo(duplicate=True)
    ses = FakeSes()

    assert send_archive_ready_email(
        dynamo, ses, table_name="metadata", subject="abc"
    ) is False
    assert ses.messages == []


def test_archive_ready_email_failure_releases_marker() -> None:
    dynamo = FakeDynamo()
    ses = FakeSes(fail=True)

    with pytest.raises(RuntimeError, match="ses unavailable"):
        send_archive_ready_email(dynamo, ses, table_name="metadata", subject="abc")

    assert len(dynamo.updates) == 2
    assert dynamo.updates[-1]["UpdateExpression"] == "REMOVE #marker"
