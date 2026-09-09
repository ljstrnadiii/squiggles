import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { expect, it } from "vitest";

it("preserves shared 3D views and lets the app handle the 3D button", () => {
  const html = readFileSync("index.html", "utf8");
  const dom = new JSDOM(html, {
    url: "https://example.test/?view=3d&pitch=47&bearing=31",
    runScripts: "dangerously",
  });
  try {
    expect(dom.window.location.search).toBe("?view=3d&pitch=47&bearing=31");
    const button = dom.window.document.createElement("button");
    button.setAttribute("aria-label", "Use 3D map view");
    dom.window.document.body.append(button);
    const click = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
    expect(button.dispatchEvent(click)).toBe(true);
  } finally {
    dom.window.close();
  }
});
