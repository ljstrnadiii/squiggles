# Contributing

## Setup

```bash
uv sync --locked
pnpm install --frozen-lockfile
```

## Checks

```bash
uv run pytest
uv run ruff check .
uv run mypy
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

## Expectations

- Follow `AGENTS.md`.
- Use Conventional Commit titles.
- Keep PRs focused.
- Add tests for behavior changes.
- Do not commit real activity data or credentials.
- Update docs when contracts or architecture change.
- Benchmark performance changes when practical.
