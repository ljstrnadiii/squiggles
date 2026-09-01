# Security

## Data handling

- Activity locations are private data.
- Never commit real activity data.
- Tests/docs use synthetic data or aggregate measurements only.
- Canonical activity data stays in GeoParquet; control-plane metadata stays separate.
- Browser diagnostics must not log coordinates or activity metadata.

## Archive ingestion

- Source ingestion is adapter-based; Strava export is currently supported.
- Only required activity metadata/files are accepted from the source archive.
- Reject absolute paths, traversal, excessive entries/decompression, and unsupported payloads.
- XML parsing disables external entities/network access.
- Managed upload uses owner-scoped S3 keys, short-lived URLs, declared sizes, and checksums.
- AWS Batch receives identifiers, not browser credentials.

## Authorization

- Authentication and approval are separate.
- Authorization happens before dataset metadata, upload URLs, publishing, or private-delivery credentials are returned.
- Hosted SQL is read-only and limited to authorized logical relations.
- Dataset UUIDs/slugs are not authorization boundaries.

## Browser boundary

- DuckDB-Wasm performs activity reads and SQL in a Web Worker.
- deck.gl performs rendering locally.
- Query text/schema completion stays local; no remote editor service is used.
- Basemap providers receive normal tile-coordinate requests only, not activity records.
- Blank/offline basemap avoids those third-party map requests.

## Cleaning

- Raw coordinates/telemetry remain canonical.
- Clean geometry and flags are derived and reversible.
- No replacement telemetry is fabricated.

## Publishing

Published views may expose:

- query titles and SQL
- camera location/zoom
- rendering settings
- eligible published dataset reference

They do not expose:

- identity
- source filenames
- raw activity rows
- route geometry in share metadata
- AWS credentials

Publishing is explicit. A share slug is a locator, not a secret.

## AWS

- S3 buckets block public access.
- CloudFront Origin Access Control is the public delivery path for static/unlisted content.
- Private delivery uses short-lived authorization.
- Browser never receives AWS credentials.
- GitHub deployment uses OIDC, not stored AWS access keys.
- Local operators use IAM Identity Center temporary credentials.
- Pulumi owns persistent resources.
- No NAT Gateway, database cluster, or always-on compute by default.

## State and secrets

- Pulumi state uses a private encrypted/versioned S3 bootstrap bucket.
- Secret config remains encrypted by Pulumi/passphrase.
- `.env`, AWS config, tokens, keys, and stack secrets stay untracked.
- Gitleaks runs in CI/pre-commit.
