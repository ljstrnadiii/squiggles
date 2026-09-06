from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from playwright.sync_api import Browser, Page, sync_playwright

URL = "https://squiggles.io/"
OUTPUT = Path("browser-profile-artifacts")
TAB_KEY = "activity-map.tabs.v1"


@dataclass(frozen=True)
class Scenario:
    name: str
    sql: str
    map_state: dict[str, float]
    spatial_filter: dict[str, object] | None = None


SCENARIOS = [
    Scenario(
        name="all-activities",
        sql="SELECT activity_id FROM activities",
        map_state={"longitude": -105.0, "latitude": 39.0, "zoom": 5.0},
    ),
    Scenario(
        name="all-runs",
        sql="SELECT activity_id FROM activities WHERE lower(sport_type) LIKE '%run%'",
        map_state={"longitude": -105.0, "latitude": 39.0, "zoom": 5.0},
    ),
    Scenario(
        name="boulder-intersects",
        sql="SELECT activity_id FROM activities",
        map_state={"longitude": -105.27, "latitude": 40.015, "zoom": 10.0},
        spatial_filter={
            "predicate": "intersects",
            "polygon": [
                [-105.32, 39.95],
                [-105.20, 39.95],
                [-105.20, 40.08],
                [-105.32, 40.08],
            ],
            "visible": False,
        },
    ),
]


PROFILES: list[dict[str, Any]] = [
    {
        "name": "desktop",
        "context": {
            "viewport": {"width": 1440, "height": 900},
            "device_scale_factor": 1,
        },
    },
    {
        "name": "mobile",
        "context": {
            "viewport": {"width": 412, "height": 915},
            "device_scale_factor": 2.625,
            "is_mobile": True,
            "has_touch": True,
        },
    },
]


def tab_payload(scenario: Scenario) -> str:
    tab: dict[str, Any] = {
        "id": "benchmark",
        "title": scenario.name,
        "sql": scenario.sql,
        "mapState": scenario.map_state,
        "style": {
            "color": "#476bcc",
            "lineWidthScale": 1,
            "basemap": "blank",
            "heatEnabled": False,
            "heatPalette": "sunset",
            "heatTemperature": 1.7,
            "cleanEnabled": False,
        },
    }
    if scenario.spatial_filter is not None:
        tab["spatialFilter"] = scenario.spatial_filter
    return json.dumps([tab])


def wait_for_draw(page: Page) -> dict[str, Any]:
    page.wait_for_function(
        """() => {
          const status = document.querySelector('.status');
          const label = status?.getAttribute('aria-label') || '';
          const failed = document.querySelector('.global-error');
          return failed || (
            label.includes('routes selected') &&
            !status?.classList.contains('working')
          );
        }""",
        timeout=120_000,
    )
    failure = page.locator(".global-error")
    if failure.count():
        raise RuntimeError(failure.inner_text())
    return page.evaluate(
        """async () => {
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const status = document.querySelector('.status');
          const canvases = [...document.querySelectorAll('canvas')];
          const resources = performance.getEntriesByType('resource');
          const parquet = resources.filter(resource => resource.name.includes('.parquet'));
          return {
            paintMs: performance.now(),
            status: status?.getAttribute('aria-label') ?? null,
            canvasCount: canvases.length,
            canvasPixels: canvases.reduce(
              (sum, canvas) => sum + canvas.width * canvas.height,
              0,
            ),
            resourceCount: resources.length,
            transferBytes: resources.reduce(
              (sum, resource) => sum + (resource.transferSize || 0),
              0,
            ),
            parquetRequests: parquet.length,
            parquetTransferBytes: parquet.reduce(
              (sum, resource) => sum + (resource.transferSize || 0),
              0,
            ),
          };
        }"""
    )


def run_scenario(
    browser: Browser,
    profile: dict[str, Any],
    scenario: Scenario,
) -> dict[str, Any]:
    console: list[str] = []
    page_errors: list[str] = []
    failed_requests: list[str] = []
    context = browser.new_context(**profile["context"])
    context.add_init_script(
        f"localStorage.setItem({json.dumps(TAB_KEY)}, {json.dumps(tab_payload(scenario))});"
    )
    page = context.new_page()
    page.on("console", lambda message: console.append(f"{message.type}: {message.text}"))
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on(
        "requestfailed",
        lambda request: failed_requests.append(
            f"{request.method} {request.url}: {request.failure or 'failed'}"
        ),
    )

    wall_started = time.perf_counter()
    response = page.goto(URL, wait_until="domcontentloaded", timeout=30_000)
    if response is None or not response.ok:
        status = response.status if response else "no response"
        raise RuntimeError(f"root navigation failed: {status}")

    try:
        draw = wait_for_draw(page)
        wall_ms = (time.perf_counter() - wall_started) * 1000
        body = page.locator("body").inner_text()
        duckdb_errors = [line for line in console if "DuckDB failure" in line]
        significant_failures = [
            failure for failure in failed_requests if "assets/maplibre-gl-worker.mjs" not in failure
        ]
        if "Squiggles DuckDB failure" in body:
            raise RuntimeError("page rendered Squiggles DuckDB failure")
        if page_errors:
            raise RuntimeError(f"page errors: {page_errors}")
        if significant_failures:
            raise RuntimeError(f"failed requests: {significant_failures}")
        if duckdb_errors:
            raise RuntimeError(f"DuckDB console errors: {duckdb_errors}")
        if draw["canvasCount"] == 0 or draw["canvasPixels"] == 0:
            raise RuntimeError("no rendered map canvas after result status")

        perf = [line for line in console if "[squiggles:perf]" in line]
        result = {
            "profile": profile["name"],
            "scenario": scenario.name,
            "sql": scenario.sql,
            "spatialFilter": scenario.spatial_filter,
            "wallToPaintMs": round(wall_ms),
            **draw,
            "perfLogs": perf[-30:],
        }
        print("PROFILE_RESULT", json.dumps(result, sort_keys=True))
        return result
    except Exception:
        OUTPUT.mkdir(exist_ok=True)
        page.screenshot(
            path=OUTPUT / f"{profile['name']}-{scenario.name}-failure.png",
            full_page=True,
        )
        raise
    finally:
        context.close()


def main() -> None:
    OUTPUT.mkdir(exist_ok=True)
    results: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        for profile in PROFILES:
            for scenario in SCENARIOS:
                try:
                    results.append(run_scenario(browser, profile, scenario))
                except Exception as error:
                    failures.append(
                        {
                            "profile": str(profile["name"]),
                            "scenario": scenario.name,
                            "error": str(error),
                        }
                    )
                    print("PROFILE_FAILURE", json.dumps(failures[-1], sort_keys=True))
        browser.close()

    report = {"results": results, "failures": failures}
    (OUTPUT / "profile.json").write_text(json.dumps(report, indent=2))
    print("PROFILE_REPORT")
    print(json.dumps(report, indent=2))
    if failures:
        raise RuntimeError(f"{len(failures)} hosted browser profile scenario(s) failed")


if __name__ == "__main__":
    main()
