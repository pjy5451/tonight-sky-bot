import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import stylesSource from "../src/styles.css?raw";
import "../src/styles.css";

const TOKENS = {
  bg: "#05070d",
  panel: "#0b0f19",
  line: "#1c2333",
  text: "#e9edf5",
  muted: "#8a94a8",
  label: "#7c869a",
  amber: "#e8b04a",
  cyan: "#7fd3ff",
  "sat-korea": "#ff7a59",
  "sat-starlink": "#a9b8d6",
  "sat-nav": "#7bd88f",
  "sat-geo": "#c59bff",
} as const;

function tokenValue(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(stylesSource);
  return (match?.[1] ?? "").toLowerCase();
}

function channel(value: number): number {
  const unit = value / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = channel((value >> 16) & 255);
  const green = channel((value >> 8) & 255);
  const blue = channel(value & 255);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

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
  document.body.append(createApp());
}

function fits(width: number) {
  const rootWidth = document.documentElement.clientWidth || width;
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(rootWidth);
  const tooWide: string[] = [];
  for (const element of document.querySelectorAll<HTMLElement>("*")) {
    for (const value of [getComputedStyle(element).width, getComputedStyle(element).minWidth]) {
      const match = /^(\d+(?:\.\d+)?)px$/.exec(value);
      if (match && Number(match[1]) > width) {
        tooWide.push(`${element.id || element.className || element.tagName}: ${value}`);
      }
    }
  }
  expect(tooWide).toEqual([]);
}

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.style.width = "";
  document.body.style.width = "";
});

describe("observatory design tokens", () => {
  it("defines the v2 palette once in :root", () => {
    for (const [name, value] of Object.entries(TOKENS)) {
      expect(tokenValue(name), name).toBe(value);
    }
    expect(stylesSource).toContain('"IBM Plex Sans KR"');
    expect(stylesSource).toContain('"IBM Plex Mono"');
    expect(stylesSource).not.toContain("Noto Sans KR");
    expect(stylesSource).not.toContain("Space Grotesk");
  });

  it("keeps body, secondary, and label text at least 4.5:1 on the page and panels", () => {
    const backgrounds = [TOKENS.bg, TOKENS.panel];
    const foregrounds = [TOKENS.text, TOKENS.muted, TOKENS.label];
    for (const background of backgrounds) {
      for (const foreground of foregrounds) {
        expect(contrast(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(TOKENS.bg, TOKENS.amber)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(TOKENS.amber, TOKENS.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(TOKENS.cyan, TOKENS.panel)).toBeGreaterThanOrEqual(4.5);
  });

  it("uses the panel, mono labels, and a T-minus readout without sideways scroll", () => {
    renderAt(390);

    expect(getComputedStyle(document.body).backgroundColor).toBe("rgb(5, 7, 13)");
    expect(getComputedStyle(document.body).color).toBe("rgb(233, 237, 245)");
    expect(getComputedStyle(document.body).fontFamily).toContain("IBM Plex Sans KR");
    expect(getComputedStyle(document.querySelector("h1") as HTMLElement).fontSize).toBe("24px");
    expect(getComputedStyle(document.querySelector(".location-button") as HTMLElement).borderRadius).toBe("8px");
    expect(getComputedStyle(document.querySelector("#panel-tonight .board") as HTMLElement).borderRadius).toBe(
      "14px",
    );
    expect(getComputedStyle(document.querySelector(".stat-label") as HTMLElement).fontFamily).toContain(
      "IBM Plex Mono",
    );
    expect(getComputedStyle(document.querySelector(".stat-label") as HTMLElement).color).toBe("rgb(124, 134, 154)");
    expect(document.querySelector(".globe-stage .globe-hud #iss-card")).toBeNull();
    expect(document.querySelector("#sat-detail")).toBeNull();
    expect(document.querySelector("#iss-card")).not.toBeNull();
    expect(document.querySelector(".globe-stage")?.contains(document.querySelector("#iss-card"))).toBe(false);
    expect(document.querySelector(".globe-hud .card")).toBeNull();
    expect(document.querySelector(".globe-hud #hud-altitude")).not.toBeNull();
    expect(document.querySelector(".globe-hud #hud-speed")).not.toBeNull();
    expect(document.querySelector(".t-minus")?.textContent).toBe("T\u2212");
    expect(document.querySelector("#panel-launches .launch-board")).not.toBeNull();
    expect(document.querySelector("svg")?.getAttribute("stroke-width")).toBe("1.6");
    fits(390);

    renderAt(1440);
    expect(getComputedStyle(document.querySelector("h1") as HTMLElement).fontSize).toBe("34px");
    expect(document.querySelector(".app-shell")?.classList.contains("is-desktop")).toBe(true);
    expect(document.querySelector(".globe-stage .globe-hud #iss-card")).not.toBeNull();
    expect(document.querySelector(".globe-stage .globe-hud #sat-detail")).not.toBeNull();
    expect(document.querySelector("#sat-detail-name")?.textContent).toContain("위성을 누르면");
    expect(document.querySelector(".globe-hud #hud-altitude")).toBeNull();
    fits(1440);
  });
});
