# Security

## Data classification

- Activity coordinates and telemetry are private user data.
- Authentication metadata is separate from activity data.
- Published datasets/views are explicit user actions.

## Browser

- DuckDB-Wasm runs query execution locally in the browser.
- User SQL is limited to approved logical relations.
- No browser AWS credentials.
- Local datasets can remain entirely on-device except optional basemap requests.

## Hosted access

- Private S3 buckets.
- CloudFront mediates web/dataset delivery.
- Control-plane endpoints authenticate users before private operations.
- Dataset ownership is checked before upload/read/publish actions.
- Presigned capability should be narrow in path, operation, size, and lifetime.

## SQL

Hosted/user SQL must not access:

- arbitrary files or URLs
- credentials
- arbitrary extensions
- system metadata outside the approved query surface
- write operations

## Infrastructure

- Pulumi owns persistent AWS resources.
- GitHub Actions deploys with OIDC, not stored AWS keys.
- Deployment identity should not be able to broaden its own trust policy.
- Avoid unnecessary always-on/network infrastructure.

## Ingestion

- Prefer compiling an activity archive before upload.
- Do not persist unnecessary files from a provider export.
- Reject/record malformed activities without exposing unrelated archive contents.
- Tests use synthetic activity data.

## Secrets

- Never commit credentials, tokens, user archives, or private activity files.
- Google client secret and similar provider secrets remain server/infrastructure configuration.
- Public client IDs are not treated as secrets.
