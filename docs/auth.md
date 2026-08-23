# Authentication and control plane

Squiggles uses Amazon Cognito as its OIDC authorization server and Google as the first external identity provider. The browser uses the authorization-code flow with PKCE and has no client secret. Cognito's callback exchanges the Google authorization result; the application receives only Cognito tokens.

Authentication is not approval. The first authenticated API request idempotently creates a DynamoDB user record with `status=pending`. Pending or rejected users can read only their own approval status. Dataset metadata, upload authorization, saved queries, and CloudFront private-data cookies require `status=approved`. An administrator record is also required for approval endpoints; an email address or Google domain is never itself an authorization rule.

The DynamoDB table is control-plane storage only. Its single-table keys cover users, datasets, saved queries, and immutable shares. Canonical activities remain Parquet/GeoParquet objects in S3 and are never copied into DynamoDB. Authorization happens before returning dataset metadata, upload URLs, or private-delivery cookies.

Managed upload accepts a compiled Squiggles dataset directory: one `dataset.json` plus only the `.parquet` objects listed by that manifest. ZIP archives, source exports, unlisted objects, absolute paths, traversal, arbitrary URLs, and non-Parquet payloads are rejected. Uploads use short-lived presigned requests with a declared size and checksum. Completion verifies ownership, object keys, sizes, checksums, manifest schema, and quotas before a dataset can become readable.

CloudFront signed cookies are the intended private-read mechanism because DuckDB issues many range requests for one dataset. The cookie policy is restricted to the approved dataset prefix and expires quickly. The current unlisted developer dataset remains a temporary acceptance path until signed-cookie delivery passes its own tests.

Persistent identity resources and metadata use deletion protection, DynamoDB point-in-time recovery, on-demand billing, and no always-on compute. Pulumi owns them. The browser never receives AWS credentials.
