import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import "../src/styles.css";

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  document.documentElement.style.width = `${width}px`;
  document.body.style.width = `${width}px`;
}

function renderAt(width: number) {
  setViewport(width);
  document.body.innerHTML = "";
  const app = createApp();
  document.body.append(app);
  return app;
}

function widthsBeyond(limit: number): string[] {
  const tooWide: string[] = [];
  for (const element of document.querySelectorAll<HTMLElement>("*")) {
    for (const value of [getComputedStyle(element).width, getComputedStyle(element).minWidth]) {
      const match = /^(\d+(?:\.\d+)?)px$/.exec(value);
      if (match && Number(match[1]) > limit) {
        tooWide.push(`${element.id || element.className || element.tagName}: ${value}`);
      }
    }
  }
  return tooWide;
}

function fitsViewport(width: number) {
  const rootWidth = document.documentElement.clientWidth || width;
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(rootWidth);
  expect(widthsBeyond(width)).toEqual([]);
}

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.style.width = "";
  document.body.style.width = "";
  vi.restoreAllMocks();
});

describe("responsive layout", () => {
  it("keeps the phone tab bar at 390px and does not scroll sideways", () => {
    renderAt(390);

    const tabList = document.querySelector(".tab-list");
    const desktopBar = document.querySelector(".desktop-bar");
    expect(tabList).not.toBeNull();
    expect(desktopBar).not.toBeNull();
    expect(getComputedStyle(tabList as HTMLElement).display).toBe("grid");
    expect(getComputedStyle(tabList as HTMLElement).position).toBe("fixed");
    expect(getComputedStyle(desktopBar as HTMLElement).display).toBe("none");
    expect(document.querySelector(".app-shell")?.classList.contains("is-desktop")).toBe(false);
    expect(document.querySelector<HTMLElement>("#panel-tonight")?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("#panel-satellites")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("#panel-launches")?.hidden).toBe(true);
    expect(document.querySelector(".hero-top")?.contains(document.querySelector("#location-button"))).toBe(
      true,
    );
    expect(document.querySelector("#desk-stats")?.hasAttribute("hidden")).toBe(true);
    expect(document.querySelector(".hero-copy")?.contains(document.querySelector("#tracked-summary"))).toBe(true);
    expect(document.querySelector("#summary-cloud")).toBeNull();
    expect(getComputedStyle(document.querySelector(".globe-stage") as HTMLElement).height).toBe("340px");
    expect(document.querySelector(".globe-stage .globe-hud #iss-card")).toBeNull();
    expect(document.querySelector("#sat-detail")).toBeNull();
    expect(document.querySelector("#iss-card")).not.toBeNull();

    const satellites = document.querySelector("#panel-satellites") as HTMLElement;
    satellites.scrollIntoView = vi.fn();
    document.querySelector<HTMLButtonElement>("#tab-satellites")?.click();
    expect(satellites.scrollIntoView).not.toHaveBeenCalled();
    expect(satellites.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("#panel-tonight")?.hidden).toBe(true);

    fitsViewport(390);
  });

  it("shows the top menu and one dashboard at 1440px without sideways scroll", () => {
    renderAt(1440);

    const tabList = document.querySelector(".tab-list");
    const desktopBar = document.querySelector(".desktop-bar");
    const desktopNav = document.querySelector(".desktop-nav");
    expect(getComputedStyle(tabList as HTMLElement).display).toBe("none");
    expect(getComputedStyle(desktopBar as HTMLElement).display).toBe("block");
    expect(getComputedStyle(desktopBar as HTMLElement).backgroundColor).toBe("rgb(5, 7, 13)");
    expect(getComputedStyle(document.querySelector(".panel-stack") as HTMLElement).display).toBe("grid");
    expect(document.querySelector(".app-shell")?.classList.contains("is-desktop")).toBe(true);
    expect(document.querySelector(".brand-name")?.textContent).toBe("Argonova");
    expect(desktopNav?.textContent).toContain("하늘");
    expect(desktopNav?.textContent).toContain("지구");
    expect(desktopNav?.textContent).toContain("발사");
    for (const banned of ["참여", "커뮤니티", "배우기", "후원", "검색", "로그인"]) {
      expect(desktopBar?.textContent ?? "").not.toContain(banned);
    }
    expect(document.querySelector("#language-button")?.textContent).toBe("KO · EN");
    expect(getComputedStyle(document.querySelector("#language-button") as HTMLElement).minHeight).toBe("44px");
    expect(getComputedStyle(document.querySelector(".desktop-tab") as HTMLElement).minHeight).toBe("44px");
    expect(
      document.querySelector(".desktop-tools")?.contains(document.querySelector("#location-button")),
    ).toBe(true);

    expect(document.querySelector("#summary-cloud")).toBeNull();
    expect(document.querySelector("#desk-stats")?.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector("#summary-moon")?.textContent).toBe("—");
    expect(document.querySelector("#tracked-slot")?.contains(document.querySelector("#tracked-summary"))).toBe(
      true,
    );
    expect(getComputedStyle(document.querySelector("#panel-tonight") as HTMLElement).width).toBe("380px");
    expect(getComputedStyle(document.querySelector("#panel-satellites") as HTMLElement).minHeight).toBe("560px");
    expect(getComputedStyle(document.querySelector(".globe-stage") as HTMLElement).height).toBe("560px");
    expect(document.querySelector(".globe-stage .globe-hud #iss-card")).not.toBeNull();
    expect(document.querySelector(".globe-stage .globe-hud #sat-detail")).not.toBeNull();
    expect(getComputedStyle(document.querySelector("#panel-satellites") as HTMLElement).gridColumnStart).toBe("1");
    expect(getComputedStyle(document.querySelector("#panel-tonight") as HTMLElement).gridColumnStart).toBe("2");
    expect(getComputedStyle(document.querySelector("#panel-launches") as HTMLElement).gridColumnStart).toBe("1");
    expect(getComputedStyle(document.querySelector("#panel-launches") as HTMLElement).gridColumnEnd).toBe("-1");

    const later = document.querySelector("#later-launches");
    expect(later).not.toBeNull();
    for (let index = 0; index < 4; index += 1) {
      const row = document.createElement("article");
      row.className = "launch-row";
      later?.append(row);
    }
    const rows = [...(later?.querySelectorAll(".launch-row") ?? [])];
    expect(getComputedStyle(rows[0] as HTMLElement).display).not.toBe("none");
    expect(getComputedStyle(rows[1] as HTMLElement).display).not.toBe("none");
    expect(getComputedStyle(rows[2] as HTMLElement).display).toBe("none");
    expect(getComputedStyle(rows[3] as HTMLElement).display).toBe("none");

    expect(document.querySelector<HTMLElement>("#panel-tonight")?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("#panel-satellites")?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("#panel-launches")?.hidden).toBe(false);
    expect(getComputedStyle(document.querySelector("#panel-tonight .card-highlight") as HTMLElement).borderTopColor).toBe(
      "rgb(28, 35, 51)",
    );

    const satellites = document.querySelector("#panel-satellites") as HTMLElement;
    satellites.scrollIntoView = vi.fn();
    document.querySelector<HTMLButtonElement>("#desktop-tab-satellites")?.click();
    expect(satellites.scrollIntoView).toHaveBeenCalled();
    expect(satellites.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("#panel-tonight")?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("#panel-launches")?.hidden).toBe(false);
    expect(document.querySelector("#desktop-tab-satellites")?.getAttribute("aria-current")).toBe("true");
    expect(document.querySelector("#desktop-tab-tonight")?.hasAttribute("aria-current")).toBe(false);

    fitsViewport(1440);
  });

  it("returns to the phone tabs when the window narrows", () => {
    renderAt(1440);
    document.querySelector<HTMLButtonElement>("#desktop-tab-launches")?.click();

    setViewport(390);
    window.dispatchEvent(new Event("resize"));

    expect(document.querySelector(".app-shell")?.classList.contains("is-desktop")).toBe(false);
    expect(getComputedStyle(document.querySelector(".tab-list") as HTMLElement).display).toBe("grid");
    expect(getComputedStyle(document.querySelector(".desktop-bar") as HTMLElement).display).toBe("none");
    expect(document.querySelector<HTMLElement>("#panel-launches")?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("#panel-tonight")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("#panel-satellites")?.hidden).toBe(true);
    expect(document.querySelector(".hero-top")?.contains(document.querySelector("#location-button"))).toBe(true);
    expect(document.querySelector(".globe-stage .globe-hud #iss-card")).toBeNull();
    expect(document.querySelector("#sat-detail")).toBeNull();
    expect(document.querySelector("#iss-card")).not.toBeNull();
    expect(document.querySelector(".globe-stage")?.contains(document.querySelector("#iss-card"))).toBe(false);
    fitsViewport(390);
  });

  it("keeps the phone tabs at 1024px and does not scroll sideways", () => {
    renderAt(1024);

    expect(document.querySelector(".app-shell")?.classList.contains("is-desktop")).toBe(false);
    expect(getComputedStyle(document.querySelector(".tab-list") as HTMLElement).display).toBe("grid");
    expect(getComputedStyle(document.querySelector(".desktop-bar") as HTMLElement).display).toBe("none");
    expect(document.querySelector<HTMLElement>("#panel-tonight")?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("#panel-satellites")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("#panel-launches")?.hidden).toBe(true);
    expect(getComputedStyle(document.querySelector(".globe-stage") as HTMLElement).height).toBe("340px");
    expect(document.querySelector(".globe-stage .globe-hud #iss-card")).not.toBeNull();
    expect(document.querySelector(".globe-stage .globe-hud #sat-detail")).not.toBeNull();
    expect(document.querySelector("#desk-stats")?.hasAttribute("hidden")).toBe(true);
    fitsViewport(1024);
  });
});

describe("year1 layout captures", () => {
  it("stores Playwright captures at 1440, 1024, and 390", () => {
    for (const name of ["layout-1440.png", "layout-1024.png", "layout-390.png"]) {
      const bytes = readFileSync(`tests/screenshots/${name}`);
      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(bytes.byteLength).toBeGreaterThan(3000);
    }
  });
});
