# Naming

Use names that describe the activity archive model rather than a source provider.

## Preferred

- activity archive
- activity dataset
- canonical dataset
- source adapter
- compiled dataset
- render pyramid
- saved query / published view
- `activities` for the logical DuckDB relation

## Provider-specific names

Use provider names only at adapter boundaries or user instructions.

Examples:

- `StravaSourceAdapter`
- `compile-strava`
- “Strava exports are currently supported.”

Avoid using “Strava” as a synonym for the canonical dataset, browser engine, map, or architecture.

## Project name

- Product/repository: **Squiggles**.
- Domain: `squiggles.io`.
