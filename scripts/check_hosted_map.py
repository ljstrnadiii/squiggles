from __future__ import annotations

import json
import sys
import urllib.request

BASE_URL = "https://squiggles.io"
RENDER_PYRAMID_VERSION = "4"


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError(f"GET {url} returned {response.status}")
        return json.load(response)


def check_range(url: str) -> None:
    request = urllib.request.Request(url, headers={"Range": "bytes=0-31"})
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status not in {200, 206}:
            raise RuntimeError(f"RANGE {url} returned {response.status}")
        body = response.read(32)
        if not body:
            raise RuntimeError(f"RANGE {url} returned no bytes")
        print(f"{response.status} {url} ({len(body)} bytes)")


def main() -> None:
    config = get_json(f"{BASE_URL}/runtime-config.json")
    dataset_id = config.get("defaultDatasetId")
    if not dataset_id:
        raise RuntimeError("runtime config has no defaultDatasetId")

    root = f"{BASE_URL}/datasets/{dataset_id}"
    manifest = get_json(f"{root}/dataset.json")
    if manifest.get("render_pyramid_version") != RENDER_PYRAMID_VERSION:
        raise RuntimeError(
            f"expected render pyramid v{RENDER_PYRAMID_VERSION}, "
            f"got {manifest.get('render_pyramid_version')!r}"
        )
    shards = manifest.get("shards") or []
    levels = manifest.get("render_levels") or []
    if not shards:
        raise RuntimeError("manifest has no canonical shards")
    if not levels or any(not level.get("files") for level in levels):
        raise RuntimeError(f"manifest has no v{RENDER_PYRAMID_VERSION} render files")

    print(
        "manifest",
        {
            "dataset": dataset_id,
            "schema": manifest.get("schema_version"),
            "activities": manifest.get("activity_count"),
            "build": (manifest.get("build") or {}).get("id"),
        },
    )
    check_range(f"{root}/{shards[0]['path']}")
    check_range(f"{root}/{levels[0]['files'][0]['path']}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"hosted map smoke failed: {error}", file=sys.stderr)
        raise
