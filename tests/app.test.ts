import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

function renderApp() {
  document.body.innerHTML = "";
  const app = createApp();
  document.body.append(app);
  return app;
}

describe("tab navigation", () => {
  it("shows the tonight panel by default", () => {
    renderApp();

    expect(document.querySelector("#tab-tonight")?.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector<HTMLElement>("#panel-tonight")?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("#panel-satellites")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("#panel-launches")?.hidden).toBe(true);
  });

  it("switches panels when a tab is clicked", () => {
    renderApp();

    document.querySelector<HTMLButtonElement>("#tab-launches")?.click();

    expect(document.querySelector("#tab-launches")?.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector<HTMLElement>("#panel-tonight")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("#panel-launches")?.hidden).toBe(false);
  });
});
