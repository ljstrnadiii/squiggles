# Authentication and ownership

## Identity

- Amazon Cognito User Pool.
- Email identity supported.
- Google federation supported when configured.
- Browser uses OAuth authorization-code flow.
- Production callback: `https://squiggles.io/auth/callback`.
- Local callback: `http://localhost:5173/auth/callback`.

## Account state

- New accounts may require approval before managed uploads.
- Cognito owns authentication state.
- DynamoDB stores application metadata only:
  - user approval
  - dataset ownership
  - upload/ingest state
  - saved/published view metadata

## Authorization

- Resolve authenticated user before private data access.
- Dataset ownership is checked in the control plane.
- Presigned upload/read capability is scoped to the authorized dataset/user path.
- Published views expose only explicitly published datasets/state.
- AI/MCP clients receive no privileged access.

## Tokens

- Access and ID tokens: 1 hour.
- Refresh token: 30 days.
- Browser client has no client secret.

## Data separation

- Cognito: identity.
- DynamoDB: metadata.
- S3: activity data and uploads.
- DuckDB-Wasm: browser query execution.

## Operational rules

- Never store AWS access keys in the browser.
- Never put activity coordinates in auth metadata.
- Keep hosted SQL read-only and relation-limited.
- Delete/disable access through normal ownership workflows rather than bypassing authorization.
