import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createApp } from "../src/app";
import { defaultGlobeFilter, toggleFilterGroup, toggleKoreaOnly } from "../src/catalog";
import { exclusiveHighlight } from "../src/globe-style";
import {
  ISS_LIVE_URL,
  countGlobeViews,
  filterForView,
  formatSelectionAltitudeKm,
  formatSelectionSpeedKms,
  officialLiveUrl,
  satelliteDisplayName,
  satelliteShownInView,
  viewFromFilter,
} from "../src/globe-layout";
import { nextObserverPass } from "../src/iss-passes";
import { saveLocation } from "../src/location";
import { formatAltitude, formatSpeed, parseTleDocument, propagateStation } from "../src/satellites";
import "../src/styles.css";

const EPOCH = new Date("2000-06-27T18:50:19.733568Z");

const ISS = {
  OBJECT_NAME: "ISS (ZARYA)",
  OBJECT_ID: "1998-067A",
  EPOCH: "2000-06-27T18:50:19.733568Z",
  MEAN_MOTION: 10.82419157,
  ECCENTRICITY: 0.1859667,
  INCLINATION: 34.2682,
  RA_OF_ASC_NODE: 348.7242,
  ARG_OF_PERICENTER: 331.7664,
  MEAN_ANOMALY: 19.3264,
  NORAD_CAT_ID: 25544,
  BSTAR: 2.8098e-5,
  MEAN_MOTION_DOT: 2.3e-7,
  MEAN_MOTION_DDOT: 0,
};

const REFERENCE_OMM = {
  OBJECT_NAME: "ISS (ZARYA)",
  OBJECT_ID: "1998-067A",
  EPOCH: "2026-11-11T04:58:11.303Z",
  MEAN_MOTION: 15.49310717,
  ECCENTRICITY: 0.0007316,
  INCLINATION: 51.6322,
  RA_OF_ASC_NODE: 292.5559,
  ARG_OF_PERICENTER: 12.7435,
  MEAN_ANOMALY: 347.3737,
  NORAD_CAT_ID: 25544,
  BSTAR: 0.00017362,
  MEAN_MOTION_DOT: 0.00009235,
  MEAN_MOTION_DDOT: 0,
};

function renderApp() {
  document.body.innerHTML = "";
  const app = createApp({ now: () => EPOCH });
  document.body.append(app);
  return app;
}

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("globe view filters", () => {
  it("maps the year-1 views onto one kind at a time", () => {
    expect(viewFromFilter(filterForView("all"))).toBe("all");
    expect(exclusiveHighlight(filterForView("all"))).toBeNull();
    expect(viewFromFilter(filterForView("korea"))).toBe("korea");
    expect(exclusiveHighlight(filterForView("korea"))).toBe("korea");
    expect(viewFromFilter(filterForView("starlink"))).toBe("starlink");
    expect(exclusiveHighlight(filterForView("starlink"))).toBe("starlink");
    expect(viewFromFilter(filterForView("nav"))).toBe("nav");
    expect(exclusiveHighlight(filterForView("nav"))).toBe("nav");
    expect(viewFromFilter(filterForView("geo"))).toBe("geo");
    expect(exclusiveHighlight(filterForView("geo"))).toBe("geo");

    expect(satelliteShownInView({ group: "starlink", korean: false }, "starlink")).toBe(true);
    expect(satelliteShownInView({ group: "geo", korean: true }, "starlink")).toBe(false);
    expect(satelliteShownInView({ group: "geo", korean: true }, "korea")).toBe(true);
    expect(satelliteShownInView({ group: "gps-ops" }, "nav")).toBe(true);
    expect(satelliteShownInView({ group: "galileo" }, "nav")).toBe(true);
    expect(satelliteShownInView({ group: "starlink" }, "nav")).toBe(false);

    expect(viewFromFilter(defaultGlobeFilter())).toBe("all");
    expect(viewFromFilter(toggleKoreaOnly(defaultGlobeFilter()))).toBe("korea");
    let onlyStarlink = defaultGlobeFilter();
    for (const group of ["stations", "gps-ops", "galileo", "geo", "weather", "science", "korea"] as const) {
      onlyStarlink = toggleFilterGroup(onlyStarlink, group);
    }
    expect(viewFromFilter(onlyStarlink)).toBe("starlink");
    expect(viewFromFilter(toggleFilterGroup(defaultGlobeFilter(), "starlink"))).toBeNull();
  });

  it("counts each catalog once and keeps a satellite in every view it belongs to", () => {
    const counts = countGlobeViews([
      { noradId: 25544, group: "stations", korean: false },
      { noradId: 44714, group: "starlink", korean: false },
      { noradId: 43823, group: "geo", korean: true },
      { noradId: 43823, group: "geo", korean: true },
      { noradId: 24876, group: "gps-ops", korean: false },
      { noradId: 37846, group: "galileo", korean: false },
    ]);
    expect(counts).toEqual({ all: 5, korea: 1, starlink: 1, nav: 2, geo: 1 });
  });
});

describe("satellite selection text", () => {
  it("uses a Korean name when one is known and keeps the catalog name in English", () => {
    expect(satelliteDisplayName("ISS (ZARYA)", "ko")).toBe("국제우주정거장");
    expect(satelliteDisplayName("GEO-KOMPSAT-2A", "ko")).toBe("천리안 2A");
    expect(satelliteDisplayName("KOMPSAT-3A", "ko")).toBe("아리랑 3A");
    expect(satelliteDisplayName("KOMPSAT-3", "ko")).toBe("아리랑 3");
    expect(satelliteDisplayName("STARLINK-1008", "ko")).toBe("STARLINK-1008");
    expect(satelliteDisplayName("GEO-KOMPSAT-2A", "en")).toBe("GEO-KOMPSAT-2A");
    expect(satelliteDisplayName("  ", "ko")).toBe("—");
  });

  it("formats altitude to 0.1 km and speed to 0.01 km/s", () => {
    expect(formatSelectionAltitudeKm(417.84)).toBe("417.8 km");
    expect(formatSelectionAltitudeKm(417.85)).toBe("417.9 km");
    expect(formatSelectionSpeedKms(7.66 * 3600)).toBe("7.66 km/s");
    expect(formatSelectionAltitudeKm(Number.NaN)).toBe("—");
    expect(formatSelectionSpeedKms(Number.NaN)).toBe("—");
  });

  it("links only ISS to the official livestream", () => {
    expect(officialLiveUrl(25544)).toBe(ISS_LIVE_URL);
    expect(ISS_LIVE_URL.startsWith("https://")).toBe(true);
    expect(officialLiveUrl(48274)).toBeNull();
    expect(officialLiveUrl(undefined)).toBeNull();
  });

  it("returns the next visible pass start for the reference ISS", () => {
    const station = parseTleDocument({ items: [REFERENCE_OMM] }).stations[0];
    expect(station).toBeDefined();
    if (!station) {
      return;
    }
    const at = nextObserverPass(
      station,
      { latitude: 37.5665, longitude: 126.978, heightMeters: 38 },
      new Date("2026-11-11T00:00:00.000Z"),
    );
    expect(at).not.toBeNull();
    expect(Math.abs((at?.getTime() ?? 0) - Date.parse("2026-11-11T09:46:01Z"))).toBeLessThanOrEqual(60_000);
  });
});

describe("globe card", () => {
  it("shows the view filters, ISS selection, and livestream link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("data/tle.json")) {
          return { ok: true, json: async () => ({ fetched_at: EPOCH.toISOString(), items: [ISS] }) };
        }
        if (url.includes("data/catalog.json")) {
          return {
            ok: true,
            json: async () => ({
              fetched_at: EPOCH.toISOString(),
              items: [
                ["STARLINK-1", 44714, "starlink", "US", EPOCH.toISOString(), 15, 0.0001, 53, 1, 2, 3, 0, 0, 0],
                ["GEO-KOMPSAT-2A", 43823, "geo", "KR", EPOCH.toISOString(), 1.0027, 0.0001, 0.1, 1, 2, 3, 0, 0, 1],
              ],
            }),
          };
        }
        return { ok: true, json: async () => ({ fetched_at: null, items: [] }) };
      }),
    );

    renderApp();
    expect(document.querySelector("#tracked-summary")?.textContent).toBe("추적 위성 —");

    document.querySelector<HTMLButtonElement>("#tab-satellites")?.click();

    const label = document.querySelector(".globe-card-label");
    expect(label?.textContent).toBe("실시간 지구 · 낮과 밤 · 궤도");
    expect(getComputedStyle(label as HTMLElement).fontFamily).toContain("IBM Plex Mono");
    expect(getComputedStyle(label as HTMLElement).fontSize).toBe("11px");
    expect(getComputedStyle(label as HTMLElement).textTransform).toBe("uppercase");
    expect(getComputedStyle(label as HTMLElement).letterSpacing).not.toBe("0px");

    const all = document.querySelector<HTMLButtonElement>('[data-view="all"]');
    const korea = document.querySelector<HTMLButtonElement>('[data-view="korea"]');
    const starlink = document.querySelector<HTMLButtonElement>('[data-view="starlink"]');
    const nav = document.querySelector<HTMLButtonElement>('[data-view="nav"]');
    const geo = document.querySelector<HTMLButtonElement>('[data-view="geo"]');
    expect(all?.getAttribute("aria-pressed")).toBe("true");
    expect(korea?.getAttribute("aria-pressed")).toBe("false");
    expect(getComputedStyle(all as HTMLElement).borderRadius).toBe("8px");
    expect(getComputedStyle(all as HTMLElement).backgroundColor).toBe("rgb(233, 237, 245)");
    expect(getComputedStyle(starlink as HTMLElement).borderRadius).toBe("8px");
    expect(getComputedStyle(starlink as HTMLElement).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(all?.querySelector(".globe-view-count")?.textContent).toBe("0");
    expect(document.querySelector("#sat-selection-name")?.textContent).toBe("—");
    expect(document.querySelector("#sat-detail")).toBeNull();
    expect(document.querySelector(".globe-stage")?.contains(document.querySelector("#iss-card"))).toBe(false);
    expect(document.querySelector<HTMLAnchorElement>("#sat-live")?.hidden).toBe(true);

    starlink?.click();
    expect(starlink?.getAttribute("aria-pressed")).toBe("true");
    expect(all?.getAttribute("aria-pressed")).toBe("false");
    expect(getComputedStyle(starlink as HTMLElement).backgroundColor).toBe("rgb(233, 237, 245)");
    expect(document.querySelector('[data-group="starlink"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-group="geo"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector('[data-group="gps-ops"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector('[data-group="galileo"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector('[data-filter="korea-only"]')?.getAttribute("aria-pressed")).toBe("false");

    nav?.click();
    expect(nav?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-group="gps-ops"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-group="galileo"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-group="starlink"]')?.getAttribute("aria-pressed")).toBe("false");

    geo?.click();
    expect(geo?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-group="geo"]')?.getAttribute("aria-pressed")).toBe("true");

    korea?.click();
    expect(korea?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-filter="korea-only"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(starlink?.getAttribute("aria-pressed")).toBe("false");

    all?.click();
    expect(all?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-group="starlink"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-filter="korea-only"]')?.getAttribute("aria-pressed")).toBe("false");

    await vi.waitFor(() => {
      expect(document.querySelector("#sat-selection-name")?.textContent).toBe("국제우주정거장");
    });

    const station = parseTleDocument({ items: [ISS] }).stations[0];
    const fix = station ? propagateStation(station, EPOCH) : null;
    expect(fix).not.toBeNull();
    if (!fix) {
      return;
    }
    expect(document.querySelector("#sat-selection-alt")?.textContent).toBe(formatSelectionAltitudeKm(fix.altKm));
    expect(document.querySelector("#sat-selection-speed")?.textContent).toBe(formatSelectionSpeedKms(fix.speedKmh));
    expect(document.querySelector("#iss-altitude")?.textContent).toBe(formatAltitude(fix.altKm));
    expect(document.querySelector("#iss-speed")?.textContent).toBe(formatSpeed(fix.speedKmh));
    expect(document.querySelector("#hud-altitude")?.textContent).toBe(formatAltitude(fix.altKm));
    expect(document.querySelector("#hud-speed")?.textContent).toBe(formatSpeed(fix.speedKmh));
    const detail = document.querySelector("#sat-detail");
    const legend = document.querySelector(".legend");
    expect(detail).not.toBeNull();
    expect(document.querySelector(".globe-stage")?.contains(detail)).toBe(false);
    expect(document.querySelector(".globe-hud")?.contains(detail)).toBe(false);
    expect(
      (legend as HTMLElement).compareDocumentPosition(detail as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(document.querySelector("#sat-detail-name")?.textContent).toBe("ISS (ZARYA)");
    expect(document.querySelector("#sat-detail-kind")?.textContent).toBe("우주정거장");
    expect(document.querySelector("#sat-detail-country")?.textContent).toBe("알 수 없음");
    expect(document.querySelector("#sat-detail-altitude")?.textContent).toBe(formatAltitude(fix.altKm));
    expect(document.querySelector("#sat-selection-pass")?.textContent).toBe(
      "위치를 선택하면 통과 시각을 계산합니다.",
    );

    const live = document.querySelector<HTMLAnchorElement>("#sat-live");
    expect(live?.hidden).toBe(false);
    expect(live?.getAttribute("href")).toBe(ISS_LIVE_URL);
    expect(live?.getAttribute("target")).toBe("_blank");
    expect(live?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(live?.textContent).toContain("생중계 보기");
    expect(live?.textContent).toContain("↗");
    expect(live?.querySelector("iframe")).toBeNull();
    expect(getComputedStyle(live as HTMLElement).backgroundColor).toBe("rgb(232, 176, 74)");

    expect(document.querySelector('[data-view="all"] .globe-view-count')?.textContent).toBe("3");
    expect(document.querySelector('[data-view="korea"] .globe-view-count')?.textContent).toBe("1");
    expect(document.querySelector('[data-view="starlink"] .globe-view-count')?.textContent).toBe("1");
    expect(document.querySelector('[data-view="nav"] .globe-view-count')?.textContent).toBe("0");
    expect(document.querySelector('[data-view="geo"] .globe-view-count')?.textContent).toBe("1");
    expect(document.querySelector("#tracked-summary")?.textContent).toBe("추적 위성 3개");
    expect(document.body.innerHTML).not.toContain("iframe");
  });
});

describe("globe layout captures", () => {
  it("stores the phone and desktop Playwright captures", () => {
    for (const name of ["globe-layout-390.png", "globe-layout-1440.png"]) {
      const bytes = readFileSync(`tests/screenshots/${name}`);
      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(bytes.byteLength).toBeGreaterThan(3000);
    }
  });
});
