SHELL := /bin/bash

.PHONY: help verify secrets

help:
	@echo "make verify   Run all local checks, including infrastructure typing"
	@echo "make secrets  Scan Git-visible files and history with gitleaks"

verify:
	pnpm install --frozen-lockfile
	pnpm lint
	pnpm test
	pnpm typecheck
	pnpm build
	pnpm --filter @squiggles/aws build
	uv run ruff check .
	uv run mypy
	uv run pytest

secrets:
	@command -v gitleaks >/dev/null || (echo "gitleaks is missing; install it with 'brew install gitleaks'." && exit 1)
	@scan_dir="$$(mktemp -d)"; \
		trap 'rm -rf "$$scan_dir"' EXIT; \
		git ls-files --cached --others --exclude-standard -z | \
		while IFS= read -r -d '' file; do \
			mkdir -p "$$scan_dir/$$(dirname "$$file")"; \
			cp "$$file" "$$scan_dir/$$file"; \
		done; \
		gitleaks dir "$$scan_dir" --redact --verbose
	@if git rev-parse --verify HEAD >/dev/null 2>&1; then \
		gitleaks git --redact --verbose; \
	else \
		echo "No Git history yet; skipped history scan."; \
	fi
