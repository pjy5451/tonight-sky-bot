import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type AppOptions } from "../src/app";
import { LOCATION_STORAGE_KEY, saveLocation } from "../src/location";
import { nextMeteorShower } from "../src/meteors";
import { formatKstTime } from "../src/sky";
import {
  formatAltitude,
  formatGroundPosition,
  formatSpeed,
  parseTleDocument,
  propagateStation,
} from "../src/satellites";
import indexHtml from "../index.html?raw";
import manifestText from "../public/manifest.webmanifest?raw";
import "../src/styles.css";

function renderApp(options?: AppOptions) {
  document.body.innerHTML = "";
  const app = createApp(options);
  document.body.append(app);
  return app;
}

const FIXED_NOON = new Date("2026-11-12T03:00:00.000Z");
const USNO_SUNSET = Date.parse("2026-11-12T08:24:00.000Z");

function kstClockToUtc(kstDay: string, clock: string): number {
  const [year, month, day] = kstDay.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, (hour ?? 0) - 9, minute ?? 0, 0, 0);
}

function installGeolocation(geolocation: Geolocation) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: geolocation,
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

describe("location picker", () => {
  it("saves a rounded region on this device and restores the label", () => {
    renderApp();

    document.querySelector<HTMLButtonElement>("#location-button")?.click();
    expect(document.querySelector<HTMLElement>("#location-dialog")?.hidden).toBe(false);

    document.querySelector<HTMLButtonElement>("#region-seoul")?.click();

    expect(document.querySelector("#location-label")?.textContent).toBe("서울");
    expect(document.querySelector<HTMLElement>("#location-dialog")?.hidden).toBe(true);

    const raw = localStorage.getItem(LOCATION_STORAGE_KEY);
    expect(raw).toBe(
      JSON.stringify({
        latitude: 37.6,
        longitude: 127,
        label: "서울",
        source: "region",
      }),
    );
    expect(raw).not.toContain("37.566");

    document.body.innerHTML = "";
    document.body.append(createApp());
    expect(document.querySelector("#location-label")?.textContent).toBe("서울");
  });

  it("stores a rounded device position without keeping the raw reading", () => {
    installGeolocation({
      getCurrentPosition(success) {
        success({
          coords: {
            latitude: 37.56640556,
            longitude: 126.97782222,
            accuracy: 20,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
            toJSON() {
              return {};
            },
          },
          timestamp: 0,
          toJSON() {
            return {};
          },
        });
      },
      watchPosition() {
        return 0;
      },
      clearWatch() {},
    });

    renderApp();
    document.querySelector<HTMLButtonElement>("#location-button")?.click();
    document.querySelector<HTMLButtonElement>("#use-current-location")?.click();

    const raw = localStorage.getItem(LOCATION_STORAGE_KEY);
    expect(raw).toBe(
      JSON.stringify({
        latitude: 37.6,
        longitude: 127,
        label: "내 위치",
        source: "geolocation",
      }),
    );
    expect(raw).not.toContain("126.977");
    expect(document.querySelector("#location-label")?.textContent).toBe("내 위치");
  });

  it("offers the region list when location permission is denied", () => {
    installGeolocation({
      getCurrentPosition(_success, error) {
        error?.({
          code: 1,
          message: "denied",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        } as GeolocationPositionError);
      },
      watchPosition() {
        return 0;
      },
      clearWatch() {},
    });

    renderApp();
    document.querySelector<HTMLButtonElement>("#location-button")?.click();
    document.querySelector<HTMLButtonElement>("#use-current-location")?.click();

    expect(document.querySelector("#location-error")?.textContent).toBe(
      "위치 권한을 허용하지 않았습니다. 시·도를 선택해 주세요.",
    );
    expect(localStorage.getItem(LOCATION_STORAGE_KEY)).toBeNull();
    expect(document.querySelector("#region-busan")).not.toBeNull();

    document.querySelector<HTMLButtonElement>("#region-busan")?.click();

    expect(document.querySelector("#location-label")?.textContent).toBe("부산");
    expect(document.querySelector("h1")?.textContent).toContain(" · 부산");
    expect(JSON.parse(localStorage.getItem(LOCATION_STORAGE_KEY) ?? "{}")).toMatchObject({
      latitude: 35.2,
      longitude: 129.1,
      label: "부산",
      source: "region",
    });
  });
});

describe("Argonova frame", () => {
  it("sets the page title and manifest name to Argonova and the heading to the date", () => {
    const html = indexHtml;
    const manifest = JSON.parse(manifestText) as {
      name: string;
      short_name: string;
    };

    expect(html).toContain("<title>Argonova</title>");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain("fonts.googleapis.com");
    expect(html).toContain("IBM+Plex+Sans+KR");
    expect(html).toContain("IBM+Plex+Mono");
    expect(manifest.name).toBe("Argonova");
    expect(manifest.short_name).toBe("Argonova");

    renderApp({ now: () => new Date("2026-11-12T03:00:00.000Z") });
    expect(document.title).toBe("Argonova");
    expect(document.querySelector("h1")?.textContent).toBe("11월 12일 (목)");
    expect(document.querySelector("#time-zone")?.textContent).toBe("GMT+9");
    expect(document.querySelector(".eyebrow")).toBeNull();
    expect(document.querySelector("#tracked-summary")).not.toBeNull();
    expect(getComputedStyle(document.body).fontFamily).toContain("IBM Plex Sans KR");
  });

  it("pins the tab bar to the bottom and highlights the current tab", () => {
    renderApp();

    const tabList = document.querySelector(".tab-list");
    const main = document.querySelector("main");
    expect(tabList).not.toBeNull();
    expect(main).not.toBeNull();
    expect(
      (main as HTMLElement).compareDocumentPosition(tabList as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const barStyle = getComputedStyle(tabList as HTMLElement);
    expect(barStyle.position).toBe("fixed");
    expect(barStyle.bottom).toBe("0px");
    expect(barStyle.backgroundColor).toBe("rgb(11, 15, 25)");

    expect(getComputedStyle(document.querySelector("#tab-tonight") as HTMLElement).color).toBe(
      "rgb(232, 176, 74)",
    );
    expect(getComputedStyle(document.querySelector("#tab-launches") as HTMLElement).color).toBe(
      "rgb(138, 148, 168)",
    );

    document.querySelector<HTMLButtonElement>("#tab-launches")?.click();
    expect(getComputedStyle(document.querySelector("#tab-launches") as HTMLElement).color).toBe(
      "rgb(232, 176, 74)",
    );
  });

  it("uses mockup card shapes with a pending label and no sample times", () => {
    renderApp();

    const tonight = document.querySelector("#panel-tonight");
    expect(tonight?.querySelector(".stat-grid")).not.toBeNull();
    expect(tonight?.querySelector(".card-highlight")).not.toBeNull();
    expect(tonight?.textContent).toContain("일몰");
    expect(tonight?.textContent).toContain("ISS 통과");
    expect(tonight?.querySelector("#iss-pass-note")?.textContent).toBe(
      "위치를 선택하면 통과 시각을 계산합니다.",
    );
    expect(tonight?.querySelector("#iss-pass-time")?.textContent).toBe("");
    expect(tonight?.textContent).not.toMatch(/\d{1,2}:\d{2}/);

    document.querySelector<HTMLButtonElement>("#tab-satellites")?.click();
    const satellites = document.querySelector("#panel-satellites");
    expect(satellites?.querySelector(".globe-stage")).not.toBeNull();
    expect(getComputedStyle(satellites?.querySelector(".globe-stage") as HTMLElement).height).toBe("340px");
    expect(satellites?.querySelector(".legend")).not.toBeNull();
    expect(satellites?.querySelector(".card-highlight")).not.toBeNull();
    expect(satellites?.textContent).toContain("국제우주정거장 (ISS)");
    expect(satellites?.textContent).toContain("위치");
    expect(satellites?.textContent).toContain("고도");
    expect(satellites?.textContent).toContain("속도");
    expect(satellites?.textContent).toContain("다른 우주정거장·위성");
    expect(satellites?.textContent).toContain("스타링크");
    expect(satellites?.textContent).toContain("한국 위성만");
    const starlinkFilter = document.querySelector<HTMLButtonElement>('[data-group="starlink"]');
    const koreaOnly = document.querySelector<HTMLButtonElement>('[data-filter="korea-only"]');
    expect(starlinkFilter?.getAttribute("aria-pressed")).toBe("true");
    expect(koreaOnly?.getAttribute("aria-pressed")).toBe("false");
    expect(getComputedStyle(starlinkFilter as HTMLElement).minHeight).toBe("44px");
    starlinkFilter?.click();
    expect(starlinkFilter?.getAttribute("aria-pressed")).toBe("false");
    koreaOnly?.click();
    expect(koreaOnly?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("#sat-detail-name")?.textContent).toContain("위성을 누르면");
    expect(getComputedStyle(satellites?.querySelector(".legend-dot-iss") as HTMLElement).backgroundColor).toBe(
      "rgb(232, 176, 74)",
    );
    expect(getComputedStyle(satellites?.querySelector(".legend-dot-other") as HTMLElement).backgroundColor).toBe(
      "rgb(127, 211, 255)",
    );
    expect(satellites?.textContent).not.toContain("약 420 km");
    expect(satellites?.textContent).not.toContain("27,600");

    document.querySelector<HTMLButtonElement>("#tab-launches")?.click();
    const launches = document.querySelector("#panel-launches");
    expect(launches?.querySelector(".countdown")).not.toBeNull();
    expect(launches?.querySelectorAll(".countdown-cell")).toHaveLength(4);
    expect(launches?.querySelector(".card-highlight")).not.toBeNull();
    expect(launches?.textContent).toContain("다음 발사");
    expect(launches?.textContent).toContain("이후 일정");
    expect(launches?.textContent).toContain("불러오는 중");
    expect(launches?.textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("does not grow wider than a 390px screen", () => {
    document.documentElement.style.width = "390px";
    document.body.style.width = "390px";
    renderApp();

    const rootWidth = document.documentElement.clientWidth || 390;
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(rootWidth);

    const tooWide: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>("*")) {
      for (const value of [
        getComputedStyle(element).width,
        getComputedStyle(element).minWidth,
      ]) {
        const match = /^(\d+(?:\.\d+)?)px$/.exec(value);
        if (match && Number(match[1]) > 390) {
          tooWide.push(`${element.id || element.className || element.tagName}: ${value}`);
        }
      }
    }

    expect(tooWide).toEqual([]);
  });
});

describe("tonight panel", () => {
  it("shows KST sun, moon, and planets after a region is chosen", () => {
    renderApp({ now: () => FIXED_NOON });

    document.querySelector<HTMLButtonElement>("#location-button")?.click();
    document.querySelector<HTMLButtonElement>("#region-seoul")?.click();

    const sunset = document.querySelector("#sunset-value")?.textContent ?? "";
    const sunrise = document.querySelector("#sunrise-value")?.textContent ?? "";
    expect(sunset).toMatch(/^\d{2}:\d{2}$/);
    expect(Math.abs(kstClockToUtc("2026-11-12", sunset) - USNO_SUNSET)).toBeLessThanOrEqual(2 * 60 * 1000);
    expect(sunrise).toBe("07:08");
    expect(document.querySelector("#moon-value")?.textContent).toBe("8%");
    expect(document.querySelector("#moon-phase-name")?.textContent).toBe("초승달");
    expect(document.querySelector("#moon-icon svg circle")?.getAttribute("fill")).toBe("#1C2333");
    expect(document.querySelector("#moon-icon svg path")?.getAttribute("fill")).toBe("#E9EDF5");

    const names = [...document.querySelectorAll(".planet-name")].map((node) => node.textContent);
    const details = [...document.querySelectorAll(".planet-detail")].map((node) => node.textContent);
    const altitudes = [...document.querySelectorAll(".planet-altitude")].map((node) => node.textContent);
    expect(names).toEqual(["토성"]);
    expect(details).toEqual(["동남동 하늘"]);
    expect(altitudes).toEqual(["26°"]);
    expect(document.querySelector("#planet-time")?.textContent).toBe("17:51");
    expect(document.querySelector<HTMLElement>("#planet-empty")?.hidden).toBe(true);
    expect(document.querySelector("#panel-tonight")?.textContent).toContain("ISS 통과");
    expect(document.querySelector("#iss-pass-note")?.textContent).toBe("궤도 데이터를 불러오는 중");
    expect(document.querySelector("#meteor-name")?.textContent).toBe("사자자리 유성우 극대");
    expect(document.querySelector("#meteor-dday")?.textContent).toBe("D-5");
    expect(getComputedStyle(document.querySelector("#meteor-dday") as HTMLElement).color).toBe(
      "rgb(127, 211, 255)",
    );
    expect(getComputedStyle(document.querySelector("#meteor-dday") as HTMLElement).fontFamily).toContain(
      "IBM Plex Mono",
    );
    expect(getComputedStyle(document.querySelector("#sunset-value") as HTMLElement).fontFamily).toContain(
      "IBM Plex Mono",
    );
  });

  it("updates the sunset when the selected region changes", () => {
    renderApp({ now: () => FIXED_NOON });
    document.querySelector<HTMLButtonElement>("#location-button")?.click();
    document.querySelector<HTMLButtonElement>("#region-seoul")?.click();
    const seoulSunset = document.querySelector("#sunset-value")?.textContent;

    document.querySelector<HTMLButtonElement>("#location-button")?.click();
    document.querySelector<HTMLButtonElement>("#region-jeju")?.click();

    expect(document.querySelector("#location-label")?.textContent).toBe("제주");
    expect(document.querySelector("#sunset-value")?.textContent).toBe("17:34");
    expect(seoulSunset).toBe("17:24");
  });

  it("shows the planets above the horizon at the current time", () => {
    renderApp({ now: () => new Date("2026-11-12T12:00:00.000Z") });
    document.querySelector<HTMLButtonElement>("#location-button")?.click();
    document.querySelector<HTMLButtonElement>("#region-seoul")?.click();

    expect([...document.querySelectorAll(".planet-name")].map((node) => node.textContent)).toEqual(["토성"]);
    expect(document.querySelector(".planet-detail")?.textContent).toBe("남남동 하늘");
    expect(document.querySelector("#planet-time")?.textContent).toBe("21:00");
    expect(getComputedStyle(document.querySelector(".planet-dot-saturn") as HTMLElement).backgroundColor).toBe(
      "rgb(232, 211, 160)",
    );
  });

  it("says the sun does not rise or set during the midnight sun", () => {
    saveLocation(localStorage, {
      latitude: 78.2,
      longitude: 15.7,
      label: "극지방",
      source: "geolocation",
    });
    renderApp({ now: () => new Date("2026-06-21T12:00:00.000Z") });

    expect(document.querySelector("#sunrise-value")?.textContent).toBe("뜨지 않음");
    expect(document.querySelector("#sunset-value")?.textContent).toBe("지지 않음");
    expect(document.querySelector("#sunrise-value")?.classList.contains("is-note")).toBe(true);
    expect([...document.querySelectorAll(".planet-name")].map((node) => node.textContent)).toEqual([
      "금성",
      "화성",
      "목성",
      "토성",
    ]);
    expect(getComputedStyle(document.querySelector(".planet-dot-jupiter") as HTMLElement).backgroundColor).toBe(
      "rgb(232, 176, 74)",
    );
    expect(document.querySelector("#planet-time")?.textContent).toBe("21:00");
  });

  it("shows 17:51 KST planets for Seoul at 2026-11-12T04:39:00Z", () => {
    renderApp({ now: () => new Date("2026-11-12T04:39:00.000Z") });
    document.querySelector<HTMLButtonElement>("#location-button")?.click();
    document.querySelector<HTMLButtonElement>("#region-seoul")?.click();

    expect(document.querySelector("#planet-time")?.textContent).toBe("17:51");
    expect([...document.querySelectorAll(".planet-name")].map((node) => node.textContent)).toEqual(["토성"]);
    expect(document.querySelector(".planet-detail")?.textContent).toBe("동남동 하늘");
    expect(document.querySelector(".planet-altitude")?.textContent).toBe("26°");
  });

  it("asks for a location instead of showing sample times", () => {
    renderApp({ now: () => FIXED_NOON });
    expect(document.querySelector("#sunset-value")?.textContent).toBe("—");
    expect(document.querySelector("#sunrise-value")?.textContent).toBe("—");
    expect(document.querySelector("#moon-value")?.textContent).toBe("—");
    expect(document.querySelector("#planet-empty")?.textContent).toBe(
      "위치를 선택하면 오늘 밤 하늘을 계산합니다.",
    );
    expect(document.querySelector("#meteor-name")?.textContent).toBe("사자자리 유성우 극대");
    expect(document.querySelector("#meteor-dday")?.textContent).toBe("D-5");
    expect(document.querySelector("#panel-tonight")?.textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("keeps a filled tonight panel inside a 390px screen", () => {
    saveLocation(localStorage, {
      latitude: 37.6,
      longitude: 127,
      label: "서울",
      source: "region",
    });
    document.documentElement.style.width = "390px";
    document.body.style.width = "390px";
    renderApp({ now: () => new Date("2026-11-20T03:00:00.000Z") });

    expect(document.querySelector("#moon-phase-name")?.textContent).toBe("상현달과 보름달 사이");
    const rootWidth = document.documentElement.clientWidth || 390;
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(rootWidth);

    const tooWide: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>("*")) {
      for (const value of [getComputedStyle(element).width, getComputedStyle(element).minWidth]) {
        const match = /^(\d+(?:\.\d+)?)px$/.exec(value);
        if (match && Number(match[1]) > 390) {
          tooWide.push(`${element.id || element.className || element.tagName}: ${value}`);
        }
      }
    }
    expect(tooWide).toEqual([]);
  });

  it("keeps the longest meteor shower name inside a 390px screen", () => {
    const now = new Date("2026-05-07T03:00:00.000Z");
    document.documentElement.style.width = "390px";
    document.body.style.width = "390px";
    renderApp({ now: () => now });

    const next = nextMeteorShower(now);
    expect(next).toMatchObject({ shower: { id: "sda" }, daysUntil: 85 });
    expect(document.querySelector("#meteor-name")?.textContent).toBe("남쪽 물병자리 델타 유성우 극대");
    expect(document.querySelector("#meteor-dday")?.textContent).toBe("D-85");

    const rootWidth = document.documentElement.clientWidth || 390;
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(rootWidth);
  });

  it("flips the moon's bright limb south of the equator", () => {
    saveLocation(localStorage, {
      latitude: -33.9,
      longitude: 151.2,
      label: "남반구",
      source: "geolocation",
    });
    renderApp({ now: () => FIXED_NOON });
    const path = document.querySelector("#moon-icon svg path")?.getAttribute("d") ?? "";
    const numbers = [...path.matchAll(/-?\d+\.\d+/g)].map((match) => Number(match[0]));
    const xs = numbers.filter((_, index) => index % 2 === 0);
    expect(xs.length).toBeGreaterThan(10);
    expect(Math.max(...xs)).toBeLessThan(10.5);
    expect(Math.min(...xs)).toBeLessThan(3);
  });
});

describe("satellite globe panel", () => {
  it("shows the propagated ISS card from the local orbit file", async () => {
    const fetchedAt = "2000-06-27T18:50:19.733Z";
    const epoch = new Date("2000-06-27T18:50:19.733568Z");
    const iss = {
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
    const other = { ...iss, OBJECT_NAME: "CSS (TIANHE)", NORAD_CAT_ID: 48274 };
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      expect(url).not.toContain("celestrak.org");
      expect(url).not.toContain("thespacedevs.com");
      if (url.includes("data/tle.json")) {
        return {
          ok: true,
          json: async () => ({ fetched_at: fetchedAt, items: [other, iss] }),
        };
      }
      if (url.includes("data/launches.json")) {
        return {
          ok: true,
          json: async () => ({ fetched_at: fetchedAt, items: [] }),
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    document.documentElement.style.width = "390px";
    document.body.style.width = "390px";
    renderApp({ now: () => epoch });
    document.querySelector<HTMLButtonElement>("#tab-satellites")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector("#iss-altitude")?.textContent).not.toBe("—");
    });

    const station = parseTleDocument({ items: [iss] }).stations[0];
    const fix = station ? propagateStation(station, epoch) : null;
    expect(fix).not.toBeNull();
    if (!fix) {
      return;
    }

    expect(document.querySelector("#iss-place")?.textContent).toBe(formatGroundPosition(fix.lat, fix.lng));
    expect(document.querySelector("#iss-altitude")?.textContent).toBe(formatAltitude(fix.altKm));
    expect(document.querySelector("#iss-speed")?.textContent).toBe(formatSpeed(fix.speedKmh));
    expect(document.querySelector("#iss-status")?.textContent).toBe("지금");
    expect(document.querySelector("#orbit-source")?.textContent).toBe(
      `궤도 데이터: CelesTrak · ${formatKstTime(new Date(fetchedAt))} 갱신`,
    );
    expect(document.querySelector("#globe-status")?.textContent).toBe(
      "이 기기에서는 3D 지구본을 표시할 수 없습니다.",
    );
    const calls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calls.filter((url) => url.includes("data/tle.json"))).toHaveLength(1);
    expect(calls.filter((url) => url.includes("data/launches.json"))).toHaveLength(1);

    const rootWidth = document.documentElement.clientWidth || 390;
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(rootWidth);
  });

  it("explains a missing orbit file without showing sample numbers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ error: "CelesTrak 요청 실패: HTTP 503", items: [] }),
      })),
    );

    renderApp();
    document.querySelector<HTMLButtonElement>("#tab-satellites")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector("#iss-pass")?.textContent).toBe(
        "위성 궤도 데이터를 불러오지 못했습니다.",
      );
    });

    expect(document.querySelector("#iss-altitude")?.textContent).toBe("—");
    expect(document.querySelector("#iss-speed")?.textContent).toBe("—");
    expect(document.querySelector("#panel-satellites")?.textContent).not.toContain("27,600");
    expect(document.querySelector("#panel-satellites")?.textContent).not.toContain("약 420");
  });
});

describe("launch schedule", () => {
  const NOW = new Date("2026-11-12T08:38:00.000Z");

  function launchResponse() {
    return {
      fetched_at: "2026-11-12T03:00:00.000Z",
      items: [
        {
          id: "later",
          name: "Electron | Mission",
          net: "2026-11-16T00:30:00Z",
          provider: "Rocket Lab",
          rocket: "Electron",
          location: "뉴질랜드",
          webcast_urls: ["javascript:alert(1)"],
        },
        {
          id: "next",
          name: "Falcon 9 Block 5 | Starlink 위성",
          net: "2026-11-14T12:05:41Z",
          provider: "SpaceX",
          rocket: "Falcon 9",
          pad: "SLC-40",
          location: "미국 케이프커내버럴",
          webcast_urls: ["javascript:alert(1)", "https://example.com/live"],
        },
        {
          id: "past",
          name: "Past",
          net: "2026-11-11T00:00:00Z",
          rocket: "Past Rocket",
          provider: "Old",
        },
      ],
    };
  }

  it("shows the next launch in KST with a countdown and a safe livestream link", async () => {
    let current = NOW;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).not.toContain("thespacedevs.com");
      expect(url).not.toContain("celestrak.org");
      if (url.includes("data/launches.json")) {
        return {
          ok: true,
          json: async () => launchResponse(),
        };
      }
      if (url.includes("data/tle.json")) {
        return {
          ok: true,
          json: async () => ({ fetched_at: "2026-11-12T03:00:00.000Z", items: [] }),
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    document.documentElement.style.width = "390px";
    document.body.style.width = "390px";
    renderApp({ now: () => current });
    document.querySelector<HTMLButtonElement>("#tab-launches")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector("#next-launch-title")?.textContent).toBe("Falcon 9 · Starlink 위성");
    });

    expect(document.querySelector("#next-launch-when")?.textContent).toBe("11/14 (토) 21:05");
    expect(document.querySelector("#next-launch-meta")?.textContent).toBe("SpaceX · 미국 케이프커내버럴");
    expect(
      [...document.querySelectorAll("#launch-countdown .countdown-value")].map((node) => node.textContent),
    ).toEqual(["02", "03", "27", "41"]);
    expect(getComputedStyle(document.querySelector(".countdown-seconds") as HTMLElement).color).toBe(
      "rgb(232, 176, 74)",
    );
    expect(getComputedStyle(document.querySelector(".countdown-value") as HTMLElement).fontFamily).toContain(
      "IBM Plex Mono",
    );
    expect(document.querySelector(".t-minus")?.textContent).toBe("T\u2212");

    const link = document.querySelector<HTMLAnchorElement>("#launch-webcast");
    expect(link?.hidden).toBe(false);
    expect(link?.getAttribute("href")).toBe("https://example.com/live");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.textContent).toContain("생중계 보기");
    expect(getComputedStyle(link as HTMLElement).backgroundColor).toBe("rgb(232, 176, 74)");

    const rows = [...document.querySelectorAll(".launch-row")];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector(".card-title")?.textContent).toBe("Electron");
    expect(rows[0]?.querySelector(".stat-label")?.textContent).toBe("Rocket Lab · 뉴질랜드");
    expect(rows[0]?.querySelector(".launch-time")?.textContent).toBe("11/16 (월) 09:30");
    expect(rows[0]?.querySelector(".launch-dday")?.textContent).toBe("D-4");
    expect(getComputedStyle(rows[0]?.querySelector(".launch-dday") as HTMLElement).color).toBe(
      "rgb(127, 211, 255)",
    );
    expect(document.querySelector("#launch-source")?.textContent).toBe(
      "발사 데이터: The Space Devs · 12:00 갱신",
    );
    expect(document.querySelector("#panel-launches")?.textContent).not.toContain("Past Rocket");
    expect(document.body.innerHTML).not.toContain("javascript:");
    const calls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calls.filter((url) => url.includes("data/launches.json"))).toHaveLength(1);
    expect(calls.filter((url) => url.includes("data/tle.json"))).toHaveLength(1);

    current = new Date(NOW.getTime() + 1000);
    document.querySelector<HTMLButtonElement>("#tab-tonight")?.click();
    document.querySelector<HTMLButtonElement>("#tab-launches")?.click();
    expect(
      [...document.querySelectorAll("#launch-countdown .countdown-value")].map((node) => node.textContent),
    ).toEqual(["02", "03", "27", "40"]);
    const callsAfter = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(callsAfter.filter((url) => url.includes("data/launches.json"))).toHaveLength(1);

    const rootWidth = document.documentElement.clientWidth || 390;
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(rootWidth);
  });

  it("explains an empty launch list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ fetched_at: "2026-11-12T03:00:00.000Z", items: [] }),
      })),
    );

    renderApp({ now: () => NOW });
    document.querySelector<HTMLButtonElement>("#tab-launches")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector("#launch-status")?.textContent).toBe("다가오는 발사 일정이 없습니다.");
    });

    expect(document.querySelector<HTMLElement>("#launch-countdown")?.hidden).toBe(true);
    expect(document.querySelector("#next-launch-title")?.textContent).toBe("");
    expect(document.querySelector("#launch-webcast")?.hasAttribute("href")).toBe(false);
    expect(document.querySelector("#launch-source")?.textContent).toBe(
      "발사 데이터: The Space Devs · 12:00 갱신",
    );
    expect(document.querySelector("#launch-countdown .countdown-value")?.textContent).not.toMatch(/^\d/);
  });

  it("explains a failed launch file without showing the raw error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ error: "Launch Library 2 요청 실패: HTTP 503", items: [] }),
      })),
    );

    renderApp({ now: () => NOW });
    document.querySelector<HTMLButtonElement>("#tab-launches")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector("#launch-status")?.textContent).toBe("발사 일정을 불러오지 못했습니다.");
    });

    expect(document.querySelector("#panel-launches")?.textContent).not.toContain("HTTP 503");
    expect(document.querySelector("#panel-launches")?.textContent).not.toContain("Launch Library");
    expect(document.querySelector<HTMLElement>("#launch-countdown")?.hidden).toBe(true);
    expect(document.querySelector(".launch-row")).toBeNull();
  });
});
