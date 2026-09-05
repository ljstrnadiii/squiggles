from __future__ import annotations

import contextlib
import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "https://squiggles.io/"
ARTIFACT_DIR = Path("browser-smoke-artifacts")


def main() -> None:
    console: list[str] = []
    page_errors: list[str] = []
    failed_requests: list[str] = []
    navigations: list[str] = []
    request_started: dict[int, float] = {}
    network_timings: list[dict[str, object]] = []
    ARTIFACT_DIR.mkdir(exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        context = browser.new_context(
            viewport={"width": 502, "height": 984},
            device_scale_factor=2,
        )
        context.tracing.start(screenshots=True, snapshots=True, sources=False)
        page = context.new_page()
        page.on("console", lambda message: console.append(f"{message.type}: {message.text}"))
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        def request_started_handler(request) -> None:
            request_started[id(request)] = time.monotonic()

        def request_finished_handler(request) -> None:
            started = request_started.pop(id(request), None)
            if started is None:
                return
            response = request.response()
            network_timings.append(
                {
                    "method": request.method,
                    "url": request.url,
                    "resourceType": request.resource_type,
                    "status": response.status if response else None,
                    "durationMs": round((time.monotonic() - started) * 1000),
                }
            )

        context.on("request", request_started_handler)
        context.on("requestfinished", request_finished_handler)
        page.on(
            "requestfailed",
            lambda request: failed_requests.append(
                f"{request.method} {request.url}: {request.failure or 'failed'}"
            ),
        )
        page.on(
            "framenavigated",
            lambda frame: navigations.append(frame.url) if frame == page.main_frame else None,
        )

        response = page.goto(URL, wait_until="domcontentloaded", timeout=30_000)
        if response is None or not response.ok:
            status = response.status if response else "no response"
            raise RuntimeError(f"root navigation failed: {status}")

        with contextlib.suppress(Exception):
            page.wait_for_function(
                """() => {
                  const status = document.querySelector('.status');
                  const label = status?.getAttribute('aria-label') || '';
                  return label.includes('routes selected') ||
                         label.includes('could not be opened') ||
                         label.includes('Query failed');
                }""",
                timeout=60_000,
            )

        state = page.evaluate(
            """() => {
              const status = document.querySelector('.status');
              return {
                url: location.href,
                pathname: location.pathname,
                search: location.search,
                status: status?.getAttribute('aria-label') ?? null,
                working: status?.classList.contains('working') ?? null,
                bodyText: document.body.innerText.slice(0, 4000),
                crossOriginIsolated,
                worker: typeof Worker,
                sharedArrayBuffer: typeof SharedArrayBuffer,
                webAssembly: typeof WebAssembly,
                resources: performance.getEntriesByType('resource').map(r => ({
                  name: r.name,
                  transferSize: r.transferSize,
                  duration: r.duration,
                })),
              };
            }"""
        )
        state["navigations"] = navigations

        print("BROWSER_STATE")
        print(json.dumps(state, indent=2))
        print("PAGE_ERRORS")
        print(json.dumps(page_errors, indent=2))
        print("FAILED_REQUESTS")
        print(json.dumps(failed_requests, indent=2))
        print("SLOW_NETWORK_REQUESTS")
        print(
            json.dumps(
                sorted(
                    (request for request in network_timings if request["durationMs"] >= 100),
                    key=lambda request: request["durationMs"],
                    reverse=True,
                )[:100],
                indent=2,
            )
        )
        print("CONSOLE")
        print(json.dumps(console[-100:], indent=2))

        passed = state["status"] == "3,189 routes selected"
        if not passed:
            (ARTIFACT_DIR / "state.json").write_text(
                json.dumps(
                    {
                        "state": state,
                        "pageErrors": page_errors,
                        "failedRequests": failed_requests,
                        "networkTimings": network_timings,
                        "console": console[-100:],
                    },
                    indent=2,
                )
            )
            page.screenshot(path=ARTIFACT_DIR / "failure.png", full_page=True)
            context.tracing.stop(path=ARTIFACT_DIR / "trace.zip")
        else:
            context.tracing.stop()
        browser.close()

    if not passed:
        raise RuntimeError(f"hosted browser did not open dataset: {state['status']!r}")


if __name__ == "__main__":
    main()
