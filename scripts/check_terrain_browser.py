"""Run with Vite on port 5173: uv run --with playwright python scripts/check_terrain_browser.py."""

from playwright.sync_api import sync_playwright


def main() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page()
        page.route("**/runtime-config.json", lambda route: route.fulfill(status=404))
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://127.0.0.1:5173/?view=3d")
        page.wait_for_timeout(3000)
        assert not errors, errors
        assert "view=3d" in page.url
        assert page.locator(".maplibregl-canvas").is_visible()
        browser.close()


if __name__ == "__main__":
    main()
