# AWS infrastructure

This Pulumi project implements the first V1 hosted development slice for the static application and one manually uploaded developer dataset. It intentionally has no server-side analytics, authentication, API, or upload service yet.

It creates separate private web and dataset buckets, CloudFront with Origin Access Control, SPA routing and range-friendly dataset delivery, Route 53 records for `squiggles.io`, an ACM certificate in `us-east-1`, incomplete multipart-upload cleanup, and an AWS Budget. The free-tier-oriented default is $10/month with notifications at 10%, 50%, and 80%; configuration cannot exceed the project's $50 development ceiling. A budget alerts but is not a hard spending cap.

No Cognito, DynamoDB, SES, Lambda, or API Gateway resource is created in this slice.

## Current status and next step

AWS Identity Center, the `squiggle-dev` CLI profile, the private S3 state backend, and the `dev` stack are initialized. The static delivery resources, developer dataset, GitHub OIDC provider, and non-self-modifying deployment role are deployed. Domain registration, certificate validation, CloudFront aliasing, and authoritative Route 53 records for `squiggles.io` are complete; public resolvers may temporarily retain negative answers from before `.io` delegation completed. The generated Pulumi passphrase is stored in macOS Keychain under service `squiggle-pulumi-dev`; it is not in the repository or an environment file. To inspect the deployed stack from the repository root:

```zsh
export AWS_PROFILE=squiggle-dev
aws sso login
cd infra/aws
set -a; source ../.env; set +a
pulumi login "$PULUMI_BACKEND_URL"
export PULUMI_CONFIG_PASSPHRASE=$(security find-generic-password -a "$USER" -s squiggle-pulumi-dev -w)
pulumi stack select "$PULUMI_STACK"
pulumi stack output
```

The compiled private developer dataset—not its source archive—is uploaded under a random UUID stored only in ignored `infra/.env`. Local and S3 aggregates match at 32 objects and 718,944,230 bytes. The CloudFront dev app, deep link, and manifest return HTTP 200; Parquet range reads return HTTP 206. The app shell checksum matches the local production build and browser isolation headers are present. The remaining acceptance step is hands-on use in a real browser. The dataset is unlisted but downloadable to anyone who obtains the URL.

## State-bucket bootstrap

This one-time bootstrap has already been completed. It is recorded here for recovery and new AWS accounts. The backend bucket is the sole exception to Pulumi ownership because it must exist before Pulumi can store state. Its globally unique name is derived from the AWS account rather than committed literally:

```zsh
export AWS_PROFILE=squiggle-dev
export AWS_REGION=us-west-2
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
PULUMI_STATE_BUCKET="squiggle-pulumi-state-$AWS_ACCOUNT_ID-$AWS_REGION"

aws s3api create-bucket \
  --bucket "$PULUMI_STATE_BUCKET" \
  --region "$AWS_REGION" \
  --create-bucket-configuration "LocationConstraint=$AWS_REGION"
aws s3api put-public-access-block \
  --bucket "$PULUMI_STATE_BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-ownership-controls \
  --bucket "$PULUMI_STATE_BUCKET" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
aws s3api put-bucket-encryption \
  --bucket "$PULUMI_STATE_BUCKET" \
  --server-side-encryption-configuration \
  'Rules=[{ApplyServerSideEncryptionByDefault={SSEAlgorithm=AES256},BucketKeyEnabled=true}]'
aws s3api put-bucket-versioning \
  --bucket "$PULUMI_STATE_BUCKET" \
  --versioning-configuration Status=Enabled
```

Never make this bucket public or upload application data to it. Its name is not a secret, but the account-specific value is intentionally absent from tracked configuration.

## Optional local environment file

This checkout uses an ignored `infra/.env` for non-secret shell defaults:

```dotenv
AWS_PROFILE=squiggle-dev
AWS_REGION=us-west-2
PULUMI_STACK=dev
PULUMI_BACKEND_URL=s3://ACCOUNT_SPECIFIC_STATE_BUCKET?region=us-west-2
```

The local file already contains the actual state bucket rather than the documentation placeholder. Load it from `infra/aws` with:

```zsh
set -a
source ../.env
set +a
pulumi login "$PULUMI_BACKEND_URL"
```

Do not add `PULUMI_CONFIG_PASSPHRASE`, AWS access keys, tokens, or activity values to this file. Keep the Pulumi passphrase in a password manager and export it only into the current shell.

## One-time local setup

Do not create root or long-lived IAM access keys. Enable MFA on the root account, create daily administrative access through IAM Identity Center, and configure a named temporary-credential profile. Install Pulumi and gitleaks with Homebrew and the AWS CLI with AWS's signed installer, then configure SSO once:

```bash
brew install pulumi gitleaks
aws configure sso --profile squiggle-dev
aws sso login --profile squiggle-dev
aws sts get-caller-identity --profile squiggle-dev
```

On this Mac, AWS's signed user-local installer avoids a Homebrew AWS SDK header conflict and places `aws` under `~/.local/bin`, which the Makefile adds to its command path.

Use Pulumi directly. The S3 backend requires the same non-empty passphrase in each new terminal session; retrieve it from Keychain rather than writing it to the repository:

```bash
export AWS_PROFILE=squiggle-dev
cd infra/aws
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
PULUMI_STATE_BUCKET="squiggle-pulumi-state-$AWS_ACCOUNT_ID-us-west-2"
pulumi login "s3://$PULUMI_STATE_BUCKET?region=us-west-2"
export PULUMI_CONFIG_PASSPHRASE=$(security find-generic-password -a "$USER" -s squiggle-pulumi-dev -w)
pulumi stack select dev
pulumi config set aws:region us-west-2
pulumi config set activity-map-aws:budgetEmail you@example.com
```

`budgetEmail` is optional. Omitting it creates the budget without email notifications. Pulumi stack configuration, `.env` files, keys, and local AWS files are gitignored; stack state lives in the private S3 backend. Run `make secrets` before deployment; it scans history and the working tree with redacted output. `protectData` defaults to `true`; explicitly set it to `false` before intentionally replacing or destroying the dataset bucket.

## Preview and deploy the AWS data plane locally

In each new terminal, authenticate AWS and load the Pulumi passphrase before using the stack:

```zsh
export AWS_PROFILE=squiggle-dev
aws sso login
cd infra/aws
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
PULUMI_STATE_BUCKET="squiggle-pulumi-state-$AWS_ACCOUNT_ID-us-west-2"
pulumi login "s3://$PULUMI_STATE_BUCKET?region=us-west-2"
export PULUMI_CONFIG_PASSPHRASE=$(security find-generic-password -a "$USER" -s squiggle-pulumi-dev -w)
pulumi stack select dev
```

Preview is read-only. Inspect the proposed resources and costs before deploying:

```zsh
pulumi preview --stack dev
```

Deploy only after accepting the preview:

```zsh
pulumi up --stack dev
pulumi stack output --stack dev
```

CloudFront commonly takes several minutes to deploy. Outputs include `datasetBaseUrl` and `dataBucketName`.

## GitHub deployment

The `production` GitHub environment stores the Pulumi passphrase and budget-notification email as encrypted secrets and the AWS account/deployment-role identifiers as environment variables. It does not store AWS access keys. GitHub exchanges its environment-bound OIDC token for a one-hour AWS session, logs into the private S3 Pulumi backend, and runs the checked-in stack after CI succeeds on `main`. The `SQUIGGLES_BUDGET_EMAIL` environment fallback preserves the locally configured budget notifications because DIY Pulumi backends do not carry the ignored local stack-config file into a fresh CI checkout.

The IAM trust is restricted to GitHub's immutable-ID subject for this repository and its `production` environment. Repositories created after July 15, 2026 include owner and repository IDs in OIDC subjects, so a name-only subject will not authenticate. The role can update the current S3/CloudFront/Route 53 delivery resources and read certificate, budget, and IAM state, but it cannot modify IAM. Bootstrap identity changes therefore require the local Identity Center workflow above. Dependabot maintains action, pnpm, and uv dependencies; semantic-release publishes GitHub releases after a successful deployment and does not publish npm or PyPI packages.

## Manually upload one developer dataset

Choose a new random UUID and copy an ignored compiled dataset beneath that exact prefix. Never upload the private source archive.

```bash
cd ../..
DATASET_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
DATA_BUCKET=$(pulumi -C infra/aws stack output dataBucketName)
AWS_PROFILE=squiggle-dev aws s3 cp data/local/strava "s3://$DATA_BUCKET/datasets/$DATASET_ID" --recursive
```

Open `APPLICATION_URL/m/$DATASET_ID`. The browser reads `/datasets/$DATASET_ID/dataset.json` and range-reads its listed GeoParquet shards directly from CloudFront. Verify that a Parquet range request returns `206 Partial Content` before accepting this slice.

```zsh
DATASET_BASE=$(pulumi -C infra/aws stack output datasetBaseUrl)
SHARD_PATH=$(jq -r '.shards[0].path' data/local/strava/dataset.json)
curl -sS -D - -o /dev/null -H 'Range: bytes=0-15' "$DATASET_BASE/$DATASET_ID/$SHARD_PATH"
```

## Destruction safety

Buckets are not force-destroyed. The data bucket is protected by default. Remove test objects deliberately, set `activity-map-aws:protectData false`, run `pulumi up`, and only then use `pulumi destroy`.
