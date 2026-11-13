import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { saveLocation } from "../src/location";
import { formatKstTime } from "../src/sky";
import "../src/styles.css";

const TRANSIT_TIME = new Date("2026-11-14T12:05:41.000Z");

vi.mock("../src/iss-transits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/iss-transits")>();
  return {
    ...actual,
    predictStationTransits: () => {
      const bucket = globalThis as { __transitCalls?: number };
      bucket.__transitCalls = (bucket.__transitCalls ?? 0) + 1;
      return [{ body: "sun" as const, time: TRANSIT_TIME }];
    },
  };
});

const ISS_OMM = {
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

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  (globalThis as { __transitCalls?: number }).__transitCalls = 0;
});

describe("ISS transit rows", () => {
  it("shows the sun or moon and the device time when a transit exists", async () => {
    saveLocation(localStorage, {
      latitude: 37.5665,
      longitude: 126.978,
      label: "서울",
      source: "region",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("data/tle.json")) {
          return {
            ok: true,
            json: async () => ({ fetched_at: "2026-11-11T04:58:11.303Z", items: [ISS_OMM] }),
          };
        }
        return { ok: true, json: async () => ({ fetched_at: null, items: [] }) };
      }),
    );

    document.body.append(createApp({ now: () => new Date("2026-11-11T00:00:00.000Z") }));

    await vi.waitFor(() => {
      expect(document.querySelector(".iss-transit-body")?.textContent).toBe("태양");
      expect(document.querySelector(".iss-transit-time")?.textContent).toBe(formatKstTime(TRANSIT_TIME));
    });
    expect(document.querySelector(".iss-transit-time")?.textContent).toBe("21:06");
    expect((document.querySelector("#iss-transit-empty") as HTMLElement | null)?.hidden).toBe(true);
    expect(getComputedStyle(document.querySelector(".iss-transit-time") as HTMLElement).color).toBe(
      "rgb(232, 176, 74)",
    );
    expect(getComputedStyle(document.querySelector(".iss-transit-time") as HTMLElement).fontFamily).toContain(
      "IBM Plex Mono",
    );

    document.querySelector<HTMLButtonElement>("#language-button")?.click();
    expect(document.querySelector(".iss-transit-body")?.textContent).toBe("Sun");
    expect(document.querySelector(".iss-transit-time")?.textContent).toBe("21:06");
    expect(document.querySelector("#iss-transit-card")?.textContent).not.toMatch(/[\u3131-\u318e\uac00-\ud7a3]/);
    expect((globalThis as { __transitCalls?: number }).__transitCalls).toBe(1);
  });
});
