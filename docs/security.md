# Security

Activity locations are private data. Real activity data must never be committed. Future hosted authorization must precede storage access, and hosted SQL must be read-only and restricted to authorized logical relations.

ZIP compilation accepts only `activities.csv` and members beneath `activities/`; absolute paths, traversal, and excessive decompression are rejected. XML parsing disables network access and external entities. Parser messages are sanitized and bounded.

Hosted source intake applies the same allowlist in the browser before transmission. It never uploads the original Strava archive. Upload authorization requires an approved Cognito user, binds one random owner-scoped S3 multipart upload to SHA-256-checked parts, expires each part URL after 15 minutes, and verifies final object size before recording `pending`. Quarantine objects and incomplete multipart uploads expire independently of curated GeoParquet.

Self-service account deletion requires a valid token for the account being deleted. It terminates jobs recorded in that account partition, deletes its filtered source objects and referenced curated dataset prefixes, deletes all control-plane records under the immutable Cognito subject, and removes the Cognito identity. It cannot name another subject or arbitrary S3 prefix.

The ingestion task can read only owner-scoped quarantine objects, write only curated dataset prefixes, and update control-plane job/dataset records. It receives identifiers as Batch environment overrides, never browser credentials. Curated user output stays in a distinct private bucket until authenticated range delivery is accepted; it is not published through the temporary unlisted developer-data origin.

`../mvmt/data` is read-only private input. Generated datasets belong under ignored `data/local/`. Tests and docs use synthetic data or aggregate counts only. The browser does not log activity metadata or coordinates.

Cleaning is non-destructive: raw coordinates, elevations, and summaries stay in the canonical row. Derived clean columns and per-point flags allow a user to opt into a conservative presentation without erasing provenance. Local view links encode the active local tab ID, camera coordinates, and rendering settings. Explicitly published links additionally make the owner's tab titles, SQL, camera, and rendering settings public at a short stable locator and count raw loads. They exclude identity, theme, units, source filenames, activity rows, and route geometry. The slug is a locator, not an authorization secret; publishing is therefore an explicit user action. Private uploaded GeoParquet is not exposed by publishing metadata.

SQL highlighting, starter queries, and schema completion are static browser code. They do not call a language service, install DuckDB extensions, or send query text/schema to a remote editor service. The existing execution worker remains the only component that evaluates selection SQL.

Street, topographic, and imagery basemaps fetch public raster tiles for the visible map extent. They do not receive activity records, but tile requests inherently reveal the viewed tile coordinates to the selected provider. Use the Blank / offline basemap when that network disclosure is undesirable. Provider attribution remains visible and the application does not bulk-download or prefetch tiles.

The local application has no data API. DuckDB-Wasm reads and queries activity shards in a Web Worker, while deck.gl renders in the user's browser. Display-unit conversion, clean-view projection, summaries, heat, and elevation profiles are all client-side operations. Static hosting does not receive query text or decoded activity rows; it only serves application assets and, for a developer/hosted dataset, requested manifest and Parquet byte ranges.

Hosted V1 datasets are deliberately unlisted, not private: anyone with `/m/<high-entropy UUID>` can access the manifest and download the underlying GeoParquet through CloudFront without authentication. Visible filters are not an authorization boundary. The UI must state this before managed upload is enabled. Dataset UUIDs never contain a Cognito subject or email, S3 blocks all public access, and CloudFront Origin Access Control is the only public read path. Upload authorization, quotas, ownership checks, server-side completion checks, and deletion are mandatory before user-managed upload is enabled.

The current AWS development hostname serves the public application shell from a private web bucket and GeoParquet from a separate private data bucket. CloudFront Origin Access Control is the only read path to either origin. The application bundle contains no real manifests, shards, screenshots, or activity values. If Vercel is enabled later, it must serve only the shell; the browser must continue fetching GeoParquet directly from CloudFront.

Pulumi is the sole owner of persistent AWS resources. The data bucket is encrypted, not force-destroyed, and protected by default; incomplete multipart uploads expire after one day. The initial distribution exposes only GET/HEAD/OPTIONS. There are no permanent browser AWS credentials, public buckets, server-side analytics, NAT gateways, databases, clusters, or always-on compute in the first hosted slice.

Local AWS deployment uses a named IAM Identity Center profile and temporary credentials. Root access keys and long-lived IAM-user keys are prohibited. Pulumi stack configuration, `.env` files, key material, and local AWS configuration are ignored; gitleaks runs through pre-commit and `make secrets`. Future GitHub deployment must use GitHub OIDC to assume a narrowly scoped AWS role rather than repository secrets containing AWS keys.

Pulumi state is stored in a dedicated S3 bootstrap bucket with public access blocked, BucketOwnerEnforced ownership, AES-256 server-side encryption, and versioning. The generated Pulumi passphrase additionally encrypts secret configuration before upload and is stored in macOS Keychain under `squiggle-pulumi-dev`, then exported only into the active shell. The state bucket never stores activity data.
