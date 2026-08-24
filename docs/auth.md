# Authentication and control plane

Squiggles uses Amazon Cognito as its OIDC authorization server and Google as the first external identity provider. The browser uses the authorization-code flow with PKCE and has no client secret. Cognito's callback exchanges the Google authorization result; the application receives only Cognito tokens.

The Google OAuth client ID is a GitHub production-environment variable and its client secret is an encrypted environment secret. The deployment workflow passes both directly to Pulumi. Pull-request validation has neither value and therefore type-checks the Cognito-only fallback without creating or changing infrastructure. Production enables only Google on the public browser client; native Cognito password sign-up is not exposed.

Authentication is not approval. The first authenticated API request idempotently creates a DynamoDB user record with `status=pending`. Pending or rejected users can read only their own approval status. Dataset metadata, upload authorization, saved queries, and CloudFront private-data cookies require `status=approved`. An administrator record is also required for approval endpoints; an email address or Google domain is never itself an authorization rule.

The first browser slice is intentionally small. `runtime-config.json` contains only the public Cognito domain, public browser client ID, and API URL. The browser generates a PKCE verifier and state, keeps both in `sessionStorage`, and exchanges the returned code directly with Cognito. Tokens also remain in `sessionStorage` so closing the browser session clears them. API Gateway validates the Cognito access token and its `openid` scope before Lambda can call `GET /api/me`; that function can only read or create the caller's own pending profile. Token refresh, administrative approval, saved-query synchronization, and upload authorization remain later acceptance stages.

The DynamoDB table is control-plane storage only. Its single-table keys cover users, datasets, saved queries, and immutable shares. Canonical activities remain Parquet/GeoParquet objects in S3 and are never copied into DynamoDB. Authorization happens before returning dataset metadata, upload URLs, or private-delivery cookies.

Managed upload accepts a compiled Squiggles dataset directory: one `dataset.json` plus only the `.parquet` objects listed by that manifest. ZIP archives, source exports, unlisted objects, absolute paths, traversal, arbitrary URLs, and non-Parquet payloads are rejected. Uploads use short-lived presigned requests with a declared size and checksum. Completion verifies ownership, object keys, sizes, checksums, manifest schema, and quotas before a dataset can become readable.

The source-intake stage accepts a Strava export ZIP in the account drawer but does not transmit that original archive. The browser reads its central directory and creates a filtered ZIP containing only `activities.csv` and files beneath `activities/`; media and all other entries remain local. Missing inputs, traversal paths, excessive entry counts, and filtered archives above the initial 1.5 GB browser limit are rejected. Short-lived, per-part-checksum S3 URLs upload the filtered source in retryable 8 MiB parts under an owner-scoped quarantine key. S3 retains completed parts so reselecting the same source after interruption resumes matching parts rather than restarting. The API verifies the final S3 size before changing `uploading` to `pending`. Pending explicitly means accepted for a future processor; it does not claim compilation has begun.

CloudFront signed cookies are the intended private-read mechanism because DuckDB issues many range requests for one dataset. The cookie policy is restricted to the approved dataset prefix and expires quickly. The current unlisted developer dataset remains a temporary acceptance path until signed-cookie delivery passes its own tests.

Persistent identity resources and metadata use deletion protection, DynamoDB point-in-time recovery, on-demand billing, and no always-on compute. Pulumi owns them. The browser never receives AWS credentials.

## First-login acceptance

1. Open `https://squiggles.io`, use the query dropdown, and choose **Account**.
2. Choose **Continue with Google** and complete Google's consent screen.
3. Cognito returns to `/auth/callback`; Squiggles exchanges the code and calls `GET /api/me`.
4. The account panel must show **Access pending**. At this stage, pending accounts cannot list data, upload, or persist queries remotely.

The first administrator is bootstrapped only after this acceptance succeeds. Inspect the newly created `USER#<Cognito sub>` / `PROFILE` record, verify the intended human out of band, and change its status and role in a separate approval stage. Do not approve based only on an email domain.

Use the checked-in operator helper after authenticating the AWS SSO profile:

```bash
aws sso login --profile squiggle-dev
pnpm users list
pnpm users approve <exact-cognito-subject>
pnpm users remove <exact-cognito-subject>
```

`list` joins pending metadata to Cognito by immutable subject and shows the Cognito email plus its verification state. Google federation maps `email_verified`; do not approve an unverified address. `approve` uses a conditional DynamoDB update and refuses a record that is no longer pending. It makes that explicitly selected first user an administrator. `remove` requires the operator to retype the exact subject (or pass `--yes` for automation), deletes the matching Cognito identity, and then deletes every item in that user's control-plane partition. Resource IDs are auto-discovered only when exactly one matching Squiggles table and user pool exist; otherwise pass `--table` and `--user-pool`. Always verify the intended human out of band before approval.
