#!/usr/bin/env python3
"""Safely list, approve, or remove Squiggles users through the AWS CLI."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import UTC, datetime
from typing import Any


def aws(arguments: list[str], profile: str) -> dict[str, Any]:
    command = ["aws", *arguments, "--profile", profile, "--output", "json", "--no-cli-pager"]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return json.loads(result.stdout or "{}")


def one_resource(values: list[str], kind: str, override: str | None) -> str:
    if override:
        return override
    if len(values) != 1:
        choices = ", ".join(values) if values else "none"
        raise SystemExit(
            f"Expected exactly one Squiggles {kind}, found: {choices}. Pass --{kind} explicitly."
        )
    return values[0]


def resources(args: argparse.Namespace) -> tuple[str, str]:
    tables = aws(["dynamodb", "list-tables"], args.profile).get("TableNames", [])
    table = one_resource(
        [name for name in tables if name.startswith("control-plane-")], "table", args.table
    )
    pools = aws(["cognito-idp", "list-user-pools", "--max-results", "60"], args.profile).get(
        "UserPools", []
    )
    pool = one_resource(
        [item["Id"] for item in pools if item.get("Name", "").startswith("users-")],
        "user-pool",
        args.user_pool,
    )
    return table, pool


def pending_users(table: str, profile: str) -> list[dict[str, Any]]:
    result = aws(
        [
            "dynamodb",
            "scan",
            "--table-name",
            table,
            "--filter-expression",
            "#status = :pending AND SK = :profile",
            "--expression-attribute-values",
            json.dumps({":pending": {"S": "pending"}, ":profile": {"S": "PROFILE"}}),
            "--projection-expression",
            "PK, email, #name, createdAt, #status",
            "--expression-attribute-names",
            json.dumps({"#status": "status", "#name": "name"}),
        ],
        profile,
    )
    return result.get("Items", [])


def list_pending(table: str, profile: str) -> None:
    items = pending_users(table, profile)
    if not items:
        print("No pending users.")
        return
    for item in items:
        subject = item["PK"]["S"].removeprefix("USER#")
        fields = [
            subject,
            *(item.get(name, {}).get("S", "") for name in ("email", "name", "createdAt")),
        ]
        print("\t".join(fields))


def approve(subject: str, table: str, profile: str) -> None:
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    aws(
        [
            "dynamodb",
            "update-item",
            "--table-name",
            table,
            "--key",
            json.dumps({"PK": {"S": f"USER#{subject}"}, "SK": {"S": "PROFILE"}}),
            "--condition-expression",
            "#status = :pending",
            "--update-expression",
            "SET #status = :approved, #role = :admin, GSI1PK = :gsi, updatedAt = :now",
            "--expression-attribute-names",
            json.dumps({"#status": "status", "#role": "role"}),
            "--expression-attribute-values",
            json.dumps(
                {
                    ":pending": {"S": "pending"},
                    ":approved": {"S": "approved"},
                    ":admin": {"S": "admin"},
                    ":gsi": {"S": "USER_STATUS#approved"},
                    ":now": {"S": now},
                }
            ),
        ],
        profile,
    )
    print(f"Approved USER#{subject} as the first administrator.")


def cognito_username(subject: str, pool: str, profile: str) -> str | None:
    token: str | None = None
    while True:
        arguments = ["cognito-idp", "list-users", "--user-pool-id", pool, "--limit", "60"]
        if token:
            arguments += ["--pagination-token", token]
        result = aws(arguments, profile)
        for user in result.get("Users", []):
            attributes = {item["Name"]: item["Value"] for item in user.get("Attributes", [])}
            if attributes.get("sub") == subject:
                return user["Username"]
        token = result.get("PaginationToken")
        if not token:
            return None


def user_items(subject: str, table: str, profile: str) -> list[dict[str, Any]]:
    result = aws(
        [
            "dynamodb",
            "query",
            "--table-name",
            table,
            "--key-condition-expression",
            "PK = :pk",
            "--expression-attribute-values",
            json.dumps({":pk": {"S": f"USER#{subject}"}}),
            "--projection-expression",
            "PK, SK",
        ],
        profile,
    )
    if result.get("LastEvaluatedKey"):
        raise SystemExit("User partition exceeds one response; refusing partial removal.")
    return result.get("Items", [])


def remove(subject: str, table: str, pool: str, profile: str, confirmed: bool) -> None:
    if not confirmed:
        answer = input(f"Type the exact Cognito subject to remove USER#{subject}: ")
        if answer != subject:
            raise SystemExit("Confirmation did not match; nothing was removed.")
    username = cognito_username(subject, pool, profile)
    if username:
        aws(
            ["cognito-idp", "admin-delete-user", "--user-pool-id", pool, "--username", username],
            profile,
        )
    items = user_items(subject, table, profile)
    for item in items:
        aws(["dynamodb", "delete-item", "--table-name", table, "--key", json.dumps(item)], profile)
    identity = "yes" if username else "not found"
    print(f"Removed USER#{subject}: Cognito identity={identity}, metadata items={len(items)}.")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--profile", default="squiggle-dev")
    result.add_argument("--table", help="DynamoDB table name; normally auto-discovered")
    result.add_argument("--user-pool", help="Cognito user pool ID; normally auto-discovered")
    commands = result.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="List pending users")
    approve_parser = commands.add_parser("approve", help="Approve one pending user as admin")
    approve_parser.add_argument("subject")
    remove_parser = commands.add_parser(
        "remove", help="Delete one exact user's Cognito identity and metadata partition"
    )
    remove_parser.add_argument("subject")
    remove_parser.add_argument(
        "--yes", action="store_true", help="Skip the exact-subject confirmation prompt"
    )
    return result


def main() -> None:
    args = parser().parse_args()
    table, pool = resources(args)
    if args.command == "list":
        list_pending(table, args.profile)
    elif args.command == "approve":
        approve(args.subject, table, args.profile)
    elif args.command == "remove":
        remove(args.subject, table, pool, args.profile, args.yes)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        if error.stderr:
            print(error.stderr.rstrip(), file=sys.stderr)
        raise SystemExit(error.returncode) from error
