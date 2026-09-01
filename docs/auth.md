# Authentication and control plane

## Identity

- Amazon Cognito is the application OIDC provider.
- Google is the current external identity provider.
- Browser uses authorization-code + PKCE.
- Browser has no client secret.
- Tokens live in `sessionStorage`.

## Approval

Authentication does not grant archive access.

- First authenticated API call creates `status=pending`.
- Pending/rejected users can read only their own status.
- Dataset, upload, publish, and private-delivery operations require `status=approved`.
- Admin approval is explicit; email/domain alone is never authorization.

## Control-plane storage

DynamoDB stores metadata only:

- users and approval state
- datasets and ownership
- ingestion jobs/uploads
- saved queries
- published shares
- view counts

Canonical activities stay in GeoParquet/S3.

## Archive upload

- Ingestion is adapter-based; Strava export is the currently supported source archive.
- Browser filters the source archive to required activity metadata/files before upload.
- Original archive is not transmitted unchanged.
- Uploads use owner-scoped multipart S3 keys, short-lived presigned URLs, size checks, and checksums.
- AWS Batch/Fargate runs the shared compiler.
- Curated output is validated GeoParquet in a separate private bucket.
- Job state is persisted and polled by the browser.

## Publishing

- Approved users get one stable `/p/<slug>` view.
- Publishing stores tabs, SQL, active tab, camera, rendering settings, and eligible dataset reference.
- Theme and display units are user preferences and are not part of the published view.
- Published camera is authoritative and is not replaced by dataset bounds.
- View counts are raw loads, not unique visitors.

## Private delivery

- CloudFront signed cookies are the intended private dataset read mechanism.
- Authorization is scoped to the approved dataset prefix and short expiration.
- DuckDB can then issue many range requests without exposing AWS credentials.

## Account deletion

Confirmed deletion removes:

- known ingestion jobs
- owner-scoped source/quarantine objects
- referenced curated datasets
- the user's control-plane partition
- Cognito identity

## Operator commands

```bash
aws sso login --profile squiggle-dev
pnpm users list
pnpm users approve <cognito-subject>
pnpm users remove <cognito-subject>
```

Verify the intended person out of band before approval.
