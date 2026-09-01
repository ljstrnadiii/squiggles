# Contributing

- Create a short-lived branch from `main`.
- Open a pull request into `main`.
- Use a Conventional Commit PR title; squash merge is required.

Examples:

- `feat: add activity filtering`
- `fix(map): preserve selected viewport`
- `docs: simplify architecture notes`
- `feat!: replace dataset manifest format`

Before opening a PR:

```bash
uv sync --locked
pnpm install --frozen-lockfile
uv run --frozen pre-commit run --all-files
make verify
```

Required checks:

- pre-commit
- Python lint/type/tests
- web lint/type/tests/build
- secret scan
- PR title validation

Delete the branch after merge.
