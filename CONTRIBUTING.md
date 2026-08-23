# Contributing

Create a short-lived branch and open a pull request into `main`. Pull request titles must use the Conventional Commits form because Squiggles uses the title as the complete squash-merge commit and semantic-release reads that commit from `main`.

Examples:

- `feat: add activity filtering`
- `fix(map): preserve the selected viewport`
- `docs: clarify local setup`
- `feat!: replace the dataset manifest format`

Before opening a pull request, run:

```bash
uv sync --locked
pnpm install --frozen-lockfile
uv run --frozen pre-commit run --all-files
make verify
```

Pull requests require the pre-commit, Python, web, secret-scan, and semantic-title checks. Use **Squash and merge**; merge commits and rebase merges are disabled. Delete the branch after merging.
