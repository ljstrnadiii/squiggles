from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

VERSION_FILE = Path("packages/ingest/src/activity_map_ingest/render_lod.py")
FORMAT_PATHS = {
    "packages/ingest/src/activity_map_ingest/geoparquet_sink.py",
    "packages/ingest/src/activity_map_ingest/render_lod.py",
    "packages/ingest/src/activity_map_ingest/schema.py",
    "packages/ingest/src/activity_map_ingest/dataset_builds.py",
}
VERSION_PATTERN = re.compile(r'^RENDER_PYRAMID_VERSION\s*=\s*["\']([^"\']+)["\']', re.MULTILINE)


def git(*arguments: str) -> str:
    return subprocess.run(
        ["git", *arguments],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def version(text: str) -> str:
    match = VERSION_PATTERN.search(text)
    if not match:
        raise RuntimeError("could not find RENDER_PYRAMID_VERSION")
    return match.group(1)


def main() -> None:
    base = sys.argv[1] if len(sys.argv) > 1 else "origin/main"
    changed = set(git("diff", "--name-only", f"{base}...HEAD").splitlines())
    format_changes = sorted(changed & FORMAT_PATHS)
    if not format_changes:
        print("No render-format-sensitive files changed.")
        return

    base_version = version(git("show", f"{base}:{VERSION_FILE.as_posix()}"))
    head_version = version(VERSION_FILE.read_text())
    if head_version == base_version:
        files = "\n".join(f"- {path}" for path in format_changes)
        raise SystemExit(
            "Render-format-sensitive files changed without bumping "
            f"RENDER_PYRAMID_VERSION ({head_version}):\n{files}"
        )
    print(f"Render pyramid version bumped: {base_version} -> {head_version}")


if __name__ == "__main__":
    main()
