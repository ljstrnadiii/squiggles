# Naming

Use **Squiggles** consistently.

- Product: `Squiggles`
- Repository: `ljstrnadiii/squiggles`
- Domain: `squiggles.io`
- Local directory: `squiggles`
- AWS project tag: `squiggles`

Compatibility notes:

- Some internal package/storage/Pulumi identifiers still use historical `activity-map` names.
- Rename those only when state/storage compatibility can be preserved.
- Route 53/ACM/CloudFront DNS for `squiggles.io` is Pulumi-managed after domain bootstrap.
