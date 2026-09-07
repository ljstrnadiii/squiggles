from __future__ import annotations

import base64
import contextlib
import io
import json
import time
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from PIL import Image
from playwright.sync_api import Browser, Page, sync_playwright

URL = "https://squiggles.io/"
ARTIFACT_DIR = Path("browser-smoke-artifacts")


def runtime_dataset_id() -> str:
    with urllib.request.urlopen(f"{URL}runtime-config.json", timeout=30) as response:
        config = json.load(response)
    dataset_id = config.get("defaultDatasetId")
    if not dataset_id:
        raise RuntimeError("runtime config has no defaultDatasetId")
    return str(dataset_id)


def wait_for_routes(page: Page, timeout: int = 70_000) -> str:
    page.wait_for_function(
        """() => (document.querySelector('.status')?.getAttribute('aria-label') || '').includes('routes selected')""",
        timeout=timeout,
    )
    return page.locator(".status").get_attribute("aria-label") or ""


def route_pixels(raw: bytes) -> int:
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    return sum(
        1
        for red, green, blue in image.getdata()
        if red > 170 and red > green * 1.25 and red > blue * 1.15
    )


def exercise_pitched_routes(browser: Browser, dataset_id: str) -> None:
    counts: dict[str, int] = {}
    base = f"{URL}m/{dataset_id}"
    for mode, pitch in (("2d", 0), ("3d", 50)):
        context = browser.new_context(
            viewport={"width": 430, "height": 932},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
        )
        page = context.new_page()
        page_errors: list[str] = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(
            f"{base}?lng=-105.2705&lat=40.0150&zoom=11&bearing=0&pitch={pitch}&basemap=carto-light&view={mode}&heat=0&color=%23ff0000",
            wait_until="domcontentloaded",
            timeout=30_000,
        )
        wait_for_routes(page)
        page.wait_for_timeout(1_500)
        if "zoom=11." not in page.url:
            raise RuntimeError(f"{mode} startup camera was replaced: {page.url}")
        if mode == "3d" and "pitch=50" not in page.url:
            raise RuntimeError(f"3D pitch was replaced: {page.url}")

        cdp = context.new_cdp_session(page)
        screenshot = base64.b64decode(
            cdp.send("Page.captureScreenshot", {"format": "png", "fromSurface": True})["data"]
        )
        counts[mode] = route_pixels(screenshot)

        if mode == "3d":
            rect = page.locator(".maplibre-base").bounding_box()
            if not rect:
                raise RuntimeError("map canvas has no bounds")
            x = rect["x"] + rect["width"] / 2
            y = rect["y"] + rect["height"] / 2
            before = page.url
            points = [
                {"x": x - 40, "y": y + 20, "radiusX": 5, "radiusY": 5, "force": 1, "id": 1},
                {"x": x + 40, "y": y + 20, "radiusX": 5, "radiusY": 5, "force": 1, "id": 2},
            ]
            cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": points})
            for delta in (15, 30, 45, 60):
                cdp.send(
                    "Input.dispatchTouchEvent",
                    {
                        "type": "touchMove",
                        "touchPoints": [
                            {**points[0], "y": y + 20 - delta},
                            {**points[1], "y": y + 20 - delta},
                        ],
                    },
                )
                time.sleep(0.04)
            cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
            page.wait_for_timeout(500)
            if page.url == before:
                raise RuntimeError("two-finger pitch gesture did not change the camera")

        if page_errors:
            raise RuntimeError(f"{mode} page errors: {page_errors}")
        context.close()

    print("ROUTE_PIXELS", counts)
    if counts["2d"] <= 5:
        raise RuntimeError(f"2D routes were not visibly rendered: {counts}")
    if counts["3d"] <= 5 or counts["3d"] <= counts["2d"] * 0.1:
        raise RuntimeError(f"pitched routes were not visibly rendered: {counts}")


def exercise_startup_interaction(browser: Browser, dataset_id: str) -> None:
    context = browser.new_context(
        viewport={"width": 430, "height": 932},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
    )
    page = context.new_page()
    page.goto(f"{URL}m/{dataset_id}", wait_until="domcontentloaded", timeout=30_000)
    page.wait_for_selector(".maplibre-base", timeout=10_000)
    rect = page.locator(".maplibre-base").bounding_box()
    if not rect:
        raise RuntimeError("startup map canvas has no bounds")
    page.mouse.move(rect["x"] + rect["width"] / 2, rect["y"] + rect["height"] / 2)
    page.mouse.wheel(0, -900)
    page.wait_for_timeout(250)
    wait_for_routes(page)
    page.wait_for_timeout(500)
    query = parse_qs(urlparse(page.url).query)
    final_zoom = float(query.get("zoom", ["0"])[0])
    print("STARTUP_CAMERA", page.url)
    if final_zoom <= 5.2:
        raise RuntimeError(f"startup interaction was overwritten by dataset fit: {page.url}")
    context.close()


def main() -> None:
    console: list[str] = []
    page_errors: list[str] = []
    failed_requests: list[str] = []
    navigations: list[str] = []
    ARTIFACT_DIR.mkdir(exist_ok=True)
    dataset_id = runtime_dataset_id()

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
                        "console": console[-100:],
                    },
                    indent=2,
                )
            )
            page.screenshot(path=ARTIFACT_DIR / "failure.png", full_page=True)
            context.tracing.stop(path=ARTIFACT_DIR / "trace.zip")
        else:
            context.tracing.stop()
        context.close()

        if passed:
            exercise_pitched_routes(browser, dataset_id)
            exercise_startup_interaction(browser, dataset_id)
        browser.close()

    if not passed:
        raise RuntimeError(f"hosted browser did not open dataset: {state['status']!r}")


if __name__ == "__main__":
    main()
