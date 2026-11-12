import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { saveLocation } from "../src/location";
import { dataSourceFooter, staleDataNotice } from "../src/sources";
import "../src/styles.css";

function renderApp(options?: { now?: () => Date }) {
  document.body.innerHTML = "";
  const app = createApp(options);
  document.body.append(app);
  return app;
}

function channel(value: number): number {
  const unit = value / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string): number {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (!match) {
    throw new Error(`색을 읽지 못했습니다: ${color}`);
  }
  const red = channel(Number(match[1]));
  const green = channel(Number(match[2]));
  const blue = channel(Number(match[3]));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function paintedBackground(element: Element): string {
  let current: Element | null = element;
  while (current) {
    const color = getComputedStyle(current).backgroundColor;
    if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
      return color;
    }
    current = current.parentElement;
  }
  return getComputedStyle(document.body).backgroundColor;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("data refresh label", () => {
  it("uses one clock when both files were fetched together", () => {
    const fetchedAt = "2026-11-12T03:00:00.000Z";
    expect(dataSourceFooter(fetchedAt, fetchedAt)).toBe("데이터: CelesTrak · The Space Devs · 12:00 갱신");
  });

  it("keeps both clocks when the files differ and skips a time it cannot read", () => {
    expect(dataSourceFooter("2026-11-12T03:00:00.000Z", "2026-11-12T06:30:00.000Z")).toBe(
      "데이터: CelesTrak 12:00 · The Space Devs 15:30 갱신",
    );
    expect(dataSourceFooter(null, "not-a-date")).toBe("데이터: CelesTrak · The Space Devs");
    expect(dataSourceFooter(null, null)).toBe("데이터: CelesTrak · The Space Devs");
  });

  it("names data that is at least 24 hours old and ignores newer files", () => {
    const fresh = "2026-11-12T00:00:00.000Z";
    expect(staleDataNotice([fresh], new Date("2026-11-12T23:59:00.000Z"))).toBeNull();
    expect(staleDataNotice([fresh], new Date("2026-11-13T00:00:00.000Z"))).toBe("24시간 전 데이터");
    expect(staleDataNotice([fresh, "2026-11-11T12:00:00.000Z"], new Date("2026-11-13T00:00:00.000Z"))).toBe(
      "36시간 전 데이터",
    );
    expect(staleDataNotice([fresh], new Date("2026-11-13T06:30:00.000Z"), "en")).toBe("Data from 30 hours ago");
    expect(staleDataNotice([null, "not-a-date"], new Date("2026-11-13T00:00:00.000Z"))).toBeNull();
  });
});

describe("tab error states", () => {
  it("shows a tonight error without the calculator's own words", () => {
    saveLocation(localStorage, {
      latitude: 37.6,
      longitude: 127,
      label: "서울",
      source: "region",
    });
    renderApp({ now: () => new Date(Number.NaN) });

    const status = document.querySelector("#tonight-status");
    expect(status?.textContent).toBe("오늘 밤 하늘을 계산하지 못했습니다.");
    expect(status?.getAttribute("role")).toBe("alert");
    expect(status?.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector("#sunset-value")?.textContent).toBe("—");
    expect(document.querySelector("#moon-value")?.textContent).toBe("—");
    expect(document.querySelector("#meteor-name")?.textContent).toBe("—");
    const tonight = document.querySelector("#panel-tonight")?.textContent ?? "";
    expect(tonight).not.toContain("RangeError");
    expect(tonight).not.toContain("시각이 올바르지 않습니다.");
  });

  it("explains a failed orbit file on the satellite tab", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    renderApp();
    document.querySelector<HTMLButtonElement>("#tab-satellites")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector("#iss-pass")?.textContent).toBe("위성 궤도 데이터를 불러오지 못했습니다.");
    });

    expect(document.querySelector("#iss-pass")?.getAttribute("role")).toBe("alert");
    expect(document.querySelector("#globe-status")?.textContent).toBe("위성 궤도 데이터를 불러오지 못했습니다.");
    expect(document.querySelector("#globe-status")?.getAttribute("role")).toBe("alert");
    expect(document.querySelector("#panel-satellites")?.getAttribute("aria-busy")).toBe("false");
    expect(document.querySelector("#panel-satellites")?.textContent).not.toContain("network down");
    expect(document.querySelector(".source-footer")?.textContent).toBe("데이터: CelesTrak · The Space Devs");
  });

  it("explains a failed launch file on the launch tab", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: "secret upstream detail" }),
      })),
    );

    renderApp();
    document.querySelector<HTMLButtonElement>("#tab-launches")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector("#launch-status")?.textContent).toBe("발사 일정을 불러오지 못했습니다.");
    });

    expect(document.querySelector("#launch-status")?.getAttribute("role")).toBe("alert");
    expect(document.querySelector<HTMLElement>("#launch-countdown")?.hidden).toBe(true);
    expect(document.querySelector("#panel-launches")?.getAttribute("aria-busy")).toBe("false");
    const launches = document.querySelector("#panel-launches")?.textContent ?? "";
    expect(launches).not.toContain("500");
    expect(launches).not.toContain("secret upstream detail");
  });

  it("keeps a loading status until the local files arrive", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await gate;
        return { ok: false, status: 503, json: async () => ({}) };
      }),
    );

    renderApp();
    expect(document.querySelector("#globe-status")?.textContent).toBe("궤도 데이터를 불러오는 중");
    expect(document.querySelector("#launch-status")?.textContent).toBe("불러오는 중");

    document.querySelector<HTMLButtonElement>("#tab-launches")?.click();
    expect(document.querySelector("#launch-status")?.textContent).toBe("불러오는 중");
    expect(document.querySelector("#launch-status")?.getAttribute("role")).toBe("status");
    expect(document.querySelector("#panel-launches")?.getAttribute("aria-busy")).toBe("true");

    document.querySelector<HTMLButtonElement>("#tab-satellites")?.click();
    expect(document.querySelector("#iss-pass")?.textContent).toBe("궤도 데이터를 불러오는 중");
    expect(document.querySelector("#iss-pass")?.getAttribute("role")).toBe("status");
    expect(document.querySelector("#panel-satellites")?.getAttribute("aria-busy")).toBe("true");

    release();
    await vi.waitFor(() => {
      expect(document.querySelector("#panel-satellites")?.getAttribute("aria-busy")).toBe("false");
    });
    expect(document.querySelector("#iss-pass")?.textContent).toBe("위성 궤도 데이터를 불러오지 못했습니다.");
  });
});

describe("refresh time on the page", () => {
  it("shows the shared refresh clock from the local files", async () => {
    const fetchedAt = "2026-11-12T03:00:00.000Z";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        expect(url).not.toContain("celestrak.org");
        expect(url).not.toContain("thespacedevs.com");
        return {
          ok: true,
          json: async () => ({ fetched_at: fetchedAt, items: [] }),
        };
      }),
    );

    renderApp();
    await vi.waitFor(() => {
      expect(document.querySelector(".source-footer")?.textContent).toBe(
        "데이터: CelesTrak · The Space Devs · 12:00 갱신",
      );
    });
    expect(document.body.textContent).not.toContain(fetchedAt);
  });

  it("keeps showing satellites and launches when the files are more than a day old", async () => {
    const epoch = new Date("2000-06-27T18:50:19.733Z");
    const fetchedAt = new Date(epoch.getTime() - 30 * 60 * 60 * 1000).toISOString();
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        expect(url).not.toContain("celestrak.org");
        expect(url).not.toContain("thespacedevs.com");
        expect(url).not.toContain("raw.githubusercontent.com");
        if (url.includes("data/launches.json")) {
          return {
            ok: true,
            json: async () => ({
              fetched_at: fetchedAt,
              items: [
                {
                  id: "next",
                  name: "Falcon 9 | Starlink",
                  net: "2000-07-01T00:00:00Z",
                  provider: "SpaceX",
                  rocket: "Falcon 9",
                  location: "플로리다",
                },
              ],
            }),
          };
        }
        if (url.includes("data/catalog.json")) {
          return { ok: true, json: async () => ({ fetched_at: fetchedAt, items: [] }) };
        }
        return { ok: true, json: async () => ({ fetched_at: fetchedAt, items: [iss] }) };
      }),
    );

    renderApp({ now: () => epoch });

    await vi.waitFor(() => {
      expect(document.querySelector("#stale-notice")?.textContent).toBe("30시간 전 데이터");
    });
    expect(document.querySelector<HTMLElement>("#stale-notice")?.hidden).toBe(false);
    expect(document.body.textContent).not.toContain("위성 궤도 데이터를 불러오지 못했습니다.");
    expect(document.body.textContent).not.toContain("발사 일정을 불러오지 못했습니다.");

    document.querySelector<HTMLButtonElement>("#tab-satellites")?.click();
    await vi.waitFor(() => {
      expect(document.querySelector("#iss-altitude")?.textContent).not.toBe("—");
    });
    expect(document.querySelector("#iss-place")?.textContent).not.toBe("—");
    expect(document.querySelector("#globe-status")?.textContent).not.toBe("위성 궤도 데이터를 불러오지 못했습니다.");

    document.querySelector<HTMLButtonElement>("#tab-launches")?.click();
    await vi.waitFor(() => {
      expect(document.querySelector("#next-launch-title")?.textContent).toBe("Falcon 9 · Starlink");
    });
    expect(document.querySelector("#launch-status")?.textContent).not.toBe("발사 일정을 불러오지 못했습니다.");
    expect(document.querySelector<HTMLElement>("#launch-countdown")?.hidden).toBe(false);
    expect(document.querySelector("#stale-notice")?.textContent).toBe("30시간 전 데이터");
  });
});

describe("basic accessibility", () => {
  it("gives every button and link a name", () => {
    renderApp();
    document.querySelector<HTMLButtonElement>("#location-button")?.click();

    const controls = [...document.querySelectorAll("button, a")];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const name = control.getAttribute("aria-label")?.trim() || control.textContent?.trim();
      expect(name, control.id || control.className).toBeTruthy();
      if (control.getAttribute("target") === "_blank") {
        expect(control.getAttribute("rel")).toContain("noopener");
        expect(control.getAttribute("rel")).toContain("noreferrer");
      }
    }

    expect(document.querySelector("#tab-tonight")?.getAttribute("aria-label")).toBe("오늘 밤");
    expect(document.querySelector("#tab-satellites")?.getAttribute("aria-label")).toBe("위성 지구본");
    expect(document.querySelector("#tab-launches")?.getAttribute("aria-label")).toBe("발사 일정");
    expect(document.querySelector("#location-button")?.getAttribute("aria-label")).toBe("위치 선택");
  });

  it("keeps text contrast at least 4.5 to 1 on the dark surfaces", () => {
    renderApp();
    const pairs: Array<[string, string]> = [
      ["h1", "h1"],
      [".stat-label", ".stat-card"],
      [".pending", ".card"],
      [".source-footer", ".source-footer"],
      ["#tab-tonight", ".tab-list"],
      ["#tab-launches", ".tab-list"],
      [".location-primary", ".location-primary"],
      [".location-close", ".location-dialog-card"],
      [".location-error", ".location-dialog-card"],
      ["#meteor-dday", ".card-row"],
    ];

    for (const [foregroundSelector, backgroundSelector] of pairs) {
      const foreground = document.querySelector(foregroundSelector);
      const background = document.querySelector(backgroundSelector);
      expect(foreground, foregroundSelector).not.toBeNull();
      expect(background, backgroundSelector).not.toBeNull();
      const ratio = contrast(
        getComputedStyle(foreground as Element).color,
        paintedBackground(background as Element),
      );
      expect(ratio, `${foregroundSelector} on ${backgroundSelector}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
