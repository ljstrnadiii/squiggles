# AWS runbook

## Architecture

- CloudFront: `squiggles.io` application and dataset delivery.
- Private S3 buckets: web, uploads, compiled datasets.
- Cognito: user identity and optional Google federation.
- API Gateway + Lambda: control plane.
- DynamoDB: ownership, approval, dataset, and published-view metadata.
- AWS Batch/Fargate: managed archive compilation.
- Route 53 + ACM: DNS/TLS.
- Pulumi: all persistent infrastructure.

Development budget target: **under $50/month**.

## Prerequisites

- AWS CLI authenticated to the development account.
- Pulumi CLI.
- Node.js + pnpm.
- Repository dependencies installed.

## Build

```bash
pnpm build
pnpm --filter @squiggles/aws build
```

## Preview

```bash
cd infra/aws
AWS_PROFILE=squiggle-dev pulumi preview --stack dev
```

## Deploy

```bash
cd infra/aws
AWS_PROFILE=squiggle-dev pulumi up --stack dev
```

CI deploys `main` through GitHub Actions OIDC after checks pass.

## Important configuration

Common Pulumi/config values include:

- `domainName` — defaults to `squiggles.io`
- `defaultDatasetId` — dataset used by the default app path when applicable
- `monthlyBudgetUsd` — must be `<= 50`
- `budgetEmail` / `SQUIGGLES_BUDGET_EMAIL`
- Google OAuth client ID/secret when federation is enabled
- `protectData` — protects persistent data resources

## Dataset delivery

- `dataset.json` is the mutable/atomic manifest pointer and is not long-term cached.
- Immutable dataset files use CloudFront caching.
- Parquet delivery must support byte-range requests.
- Published views should reference compiled activity datasets, not raw source archives.

## Ingestion

- Current source adapter supports Strava export archives.
- The canonical system is an activity-archive compiler; additional adapters may be added.
- Managed jobs run on AWS Batch/Fargate and write compiled datasets to S3.
- Prefer local compilation + compiled upload when managed ingest is unnecessary.

## Deployment security

- GitHub uses OIDC; no long-lived AWS deploy keys.
- The deploy role cannot change its own trust/permissions.
- Bootstrap IAM changes require a reviewed local Pulumi operation.
- Data buckets remain private.

## Cost controls

Avoid without an explicit architecture decision:

- NAT Gateway
- RDS/Aurora
- EKS
- OpenSearch
- ElastiCache
- always-on EC2/ECS

## Destruction

- Persistent data resources are protected by default.
- Review Pulumi plans before destructive changes.
- Do not force-destroy user data buckets as part of normal development cleanup.
