# AWS infrastructure

Pulumi-managed AWS for Squiggles.

## Architecture

- Private S3 buckets for web assets, datasets, uploads, and curated ingestion output.
- CloudFront + Origin Access Control for static app and GeoParquet delivery.
- Route 53 + ACM for `squiggles.io`.
- Cognito for identity.
- DynamoDB for control-plane metadata only.
- API Gateway + Lambda for account/upload/publish operations.
- AWS Batch/Fargate for managed archive compilation.
- ECR for immutable ingestion images.
- SES for notifications.
- AWS Budget for cost monitoring.

No always-on application/query server is required.

## Cost policy

- Default development budget: $10/month.
- Project ceiling: $50/month.
- Budget alerts are not a hard spending cap.
- Prefer serverless/scale-to-zero resources.

## Authentication

- Local operators use IAM Identity Center and profile `squiggle-dev`.
- GitHub Actions uses OIDC; no AWS access keys are stored in GitHub.
- Google federation values are supplied only to protected production deployment.

## Local stack setup

```bash
export AWS_PROFILE=squiggle-dev
aws sso login --profile squiggle-dev
cd infra/aws
pulumi login "$PULUMI_BACKEND_URL"
export PULUMI_CONFIG_PASSPHRASE=$(security find-generic-password -a "$USER" -s squiggle-pulumi-dev -w)
pulumi stack select dev
```

Preview/deploy:

```bash
pulumi preview --stack dev
pulumi up --stack dev
pulumi stack output --stack dev
```

## Pulumi state

- Stored in a dedicated private S3 bootstrap bucket.
- Public access blocked.
- Bucket-owner enforced.
- AES-256 encryption.
- Versioning enabled.
- Infrastructure state only; never activity data.

The state bucket is the documented bootstrap exception because it must exist before Pulumi can use it.

## Dataset delivery

- Compiled GeoParquet is stored below `datasets/<dataset-id>/`.
- `dataset.json` is the mutable atomic pointer.
- Immutable build objects are CloudFront-cacheable.
- Manifest delivery bypasses long-lived caching.
- Parquet delivery supports HTTP range requests.

Range check:

```bash
curl -sS -D - -o /dev/null -H 'Range: bytes=0-15' "$DATASET_URL/path/to/file.parquet"
```

Expected: `206 Partial Content`.

## Managed archive ingestion

- Ingestion is adapter-based; Strava export is currently supported.
- Browser uploads only the filtered source payload required by the adapter.
- Batch/Fargate runs the shared compiler and validator.
- Curated output is GeoParquet in the private ingested bucket.
- Jobs have no idle worker and use bounded timeout/retry behavior.

## Dataset operations

```bash
aws sso login --profile squiggle-dev
pnpm datasets --profile squiggle-dev list
pnpm datasets --profile squiggle-dev rebuild-all
pnpm datasets --profile squiggle-dev rollback <dataset-uuid> <build-id>
```

Stable manifests update only after a complete build is published.

## User operations

```bash
pnpm users list
pnpm users approve <cognito-subject>
pnpm users remove <cognito-subject>
```

Verify the intended person out of band before approval.

## Deployment

- `main` CI runs Python/web/infra/secret checks.
- Successful CI builds and deploys through the protected production environment.
- GitHub assumes a short-lived AWS role through OIDC.
- Pulumi deploys the stack.
- semantic-release creates the GitHub release.

## Safety

- Data buckets are not force-destroyed.
- Data protection defaults on.
- Never store credentials or activity data in tracked `.env`/Pulumi config.
- Run secret scanning before infrastructure changes.
- Do not add NAT Gateway, databases, clusters, or always-on compute without an explicit architecture decision.
