from __future__ import annotations

import json
from playwright.sync_api import sync_playwright

URL = "https://squiggles.io/"


def main() -> None:
    console: list[str] = []
    page_errors: list[str] = []
    failed_requests: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 502, "height": 984}, device_scale_factor=2)
        page.on("console", lambda message: console.append(f"{message.type}: {message.text}"))
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on(
            "requestfailed",
            lambda request: failed_requests.append(
                f"{request.method} {request.url}: {request.failure or 'failed'}"
            ),
        )

        response = page.goto(URL, wait_until="domcontentloaded", timeout=30_000)
        if response is None or not response.ok:
            raise RuntimeError(f"root navigation failed: {response.status if response else 'no response'}")

        try:
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
        except Exception:
            pass

        state = page.evaluate(
            """() => {
              const status = document.querySelector('.status');
              return {
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

        print("BROWSER_STATE")
        print(json.dumps(state, indent=2))
        print("PAGE_ERRORS")
        print(json.dumps(page_errors, indent=2))
        print("FAILED_REQUESTS")
        print(json.dumps(failed_requests, indent=2))
        print("CONSOLE")
        print(json.dumps(console[-100:], indent=2))
        browser.close()

    if state["status"] != "3,189 routes selected":
        raise RuntimeError(f"hosted browser did not open dataset: {state['status']!r}")


if __name__ == "__main__":
    main()
