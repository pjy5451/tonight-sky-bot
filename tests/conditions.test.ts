import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import * as conditions from "../src/conditions";
import {
  CONDITIONS_CACHE_MS,
  CONDITIONS_STORAGE_KEY,
  SWPC_KP_URL,
  distanceKm,
  formatKp,
  formatVisibilityKm,
  loadObservingConditions,
  nearestRegion,
  observingIndex,
  tonightWindow,
  type ConditionsResult,
} from "../src/conditions";
import { REGIONS, saveLocation, type KeyValueStore } from "../src/location";
import { computeTonightSky } from "../src/sky";
import "../src/styles.css";

const SUNSET = new Date("2026-11-12T08:24:00.000Z");
const NOON = new Date("2026-11-12T03:00:00.000Z");
const USER_LATITUDE = 37.6;
const USER_LONGITUDE = 127;

function memoryStore(initial?: string): KeyValueStore & { raw: string | null } {
  const state = { raw: initial ?? null };
  return {
    get raw() {
      return state.raw;
    },
    set raw(value: string | null) {
      state.raw = value;
    },
    getItem() {
      return state.raw;
    },
    setItem(_key: string, value: string) {
      state.raw = value;
    },
  };
}

function hour(iso: string): number {
  return Date.parse(iso) / 1000;
}

function forecastBody(): unknown {
  const included = [
    "2026-11-12T09:00:00.000Z",
    "2026-11-12T10:00:00.000Z",
    "2026-11-12T11:00:00.000Z",
    "2026-11-12T12:00:00.000Z",
    "2026-11-12T13:00:00.000Z",
    "2026-11-12T14:00:00.000Z",
  ];
  return {
    hourly: {
      time: [hour("2026-11-12T08:00:00.000Z"), ...included.map(hour), hour("2026-11-12T15:00:00.000Z")],
      cloud_cover: [90, 20, 20, 20, 20, 20, 20, 1],
      visibility: [1000, 18000, 18000, 18000, 18000, 18000, 18000, 500],
      relative_humidity_2m: [90, 41, 41, 41, 41, 41, 41, 10],
    },
  };
}

function kpBody(): unknown {
  return [
    ["time_tag", "Kp", "a_running", "station_count"],
    ["2026-11-12 06:00:00", "4.00", "12", "8"],
    ["2026-11-12 09:00:00", "2.33", "7", "8"],
    ["2026-11-12 12:00:00", "-1.00", "0", "0"],
  ];
}

function jsonResponse(body: unknown, ok = true): { ok: boolean; json: () => Promise<unknown> } {
  return { ok, json: async () => body };
}

function seoul() {
  const region = REGIONS.find((item) => item.id === "seoul");
  if (!region) {
    throw new Error("서울 대표 좌표가 없습니다.");
  }
  return region;
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("observing index", () => {
  it("floors the weighted cloud, moon, and visibility score", () => {
    expect(
      observingIndex({ cloudFraction: 0, moonIllumination: 0, visibilityKm: 20 }),
    ).toBe(100);
    expect(
      observingIndex({ cloudFraction: 1, moonIllumination: 1, visibilityKm: 0 }),
    ).toBe(0);
    expect(
      observingIndex({ cloudFraction: 0.5, moonIllumination: 0.5, visibilityKm: 10 }),
    ).toBe(50);
    expect(
      observingIndex({ cloudFraction: 0.08, moonIllumination: 0.31, visibilityKm: 18 }),
    ).toBe(85);
    expect(
      observingIndex({ cloudFraction: 0.2, moonIllumination: 0.31, visibilityKm: 18 }),
    ).toBe(78);
    expect(
      observingIndex({ cloudFraction: 0.2, moonIllumination: 0.31, visibilityKm: 40 }),
    ).toBe(
      observingIndex({ cloudFraction: 0.2, moonIllumination: 0.31, visibilityKm: 20 }),
    );
    expect(observingIndex({ cloudFraction: Number.NaN, moonIllumination: -2, visibilityKm: -5 })).toBe(
      85,
    );
  });

  it("is written in DESIGN.md", () => {
    const design = new TextDecoder().decode(readFileSync("DESIGN.md"));
    expect(design).toContain("100 × (0.6×(1−구름) + 0.25×(1−달 밝기) + 0.15×min(시정/20km, 1))");
    expect(design).toContain("광공해 등급은 만들지 않는다");
  });
});

describe("nearest province coordinates", () => {
  it("picks the office closest to the saved point", () => {
    expect(nearestRegion(USER_LATITUDE, USER_LONGITUDE)?.id).toBe("seoul");
    expect(nearestRegion(33.4, 126.5)?.id).toBe("jeju");
    expect(nearestRegion(seoul().latitude, seoul().longitude)?.id).toBe("seoul");
    expect(nearestRegion(Number.NaN, 127)).toBeNull();
  });

  it("keeps sunset inclusive and the next local midnight exclusive", () => {
    const night = tonightWindow(SUNSET);
    expect(night?.start).toBe(SUNSET.getTime());
    expect(night?.end).toBe(Date.parse("2026-11-12T15:00:00.000Z"));
    expect(tonightWindow(null)).toBeNull();
  });
});

describe("forecast requests", () => {
  it("averages sunset-to-midnight hours and keeps the latest valid Kp", async () => {
    const calls: string[] = [];
    const store = memoryStore();
    const result = await loadObservingConditions({
      latitude: USER_LATITUDE,
      longitude: USER_LONGITUDE,
      sunset: SUNSET,
      moonIllumination: 0.31,
      now: NOON,
      store,
      fetchImpl: async (url) => {
        calls.push(url);
        if (url.includes("open-meteo.com")) {
          return jsonResponse(forecastBody());
        }
        if (url === SWPC_KP_URL) {
          return jsonResponse(kpBody());
        }
        throw new Error(`unexpected ${url}`);
      },
    });

    expect(result).toMatchObject({
      ok: true,
      index: 78,
      cloudPercent: 20,
      visibilityKm: 18,
      humidityPercent: 41,
      kp: 2.33,
      fromCache: false,
    });
    expect(formatVisibilityKm(18)).toBe("18");
    expect(formatKp(2.33)).toBe("2.33");
    expect(calls).toHaveLength(2);
    const weather = new URL(calls[0] ?? "");
    expect(weather.origin).toBe("https://api.open-meteo.com");
    expect(weather.searchParams.get("latitude")).toBe(String(seoul().latitude));
    expect(weather.searchParams.get("longitude")).toBe(String(seoul().longitude));
    expect(weather.searchParams.get("latitude")).not.toBe(String(USER_LATITUDE));
    expect(weather.searchParams.get("longitude")).not.toBe(String(USER_LONGITUDE));
    expect([...weather.searchParams.keys()].sort()).toEqual([
      "forecast_days",
      "hourly",
      "latitude",
      "longitude",
      "timeformat",
      "timezone",
    ]);
    expect(calls[1]).toBe(SWPC_KP_URL);
    for (const url of calls) {
      const params = new URL(url).searchParams;
      if (params.has("latitude") || params.has("longitude")) {
        expect(params.get("latitude")).toBe(String(seoul().latitude));
        expect(params.get("longitude")).toBe(String(seoul().longitude));
      }
    }
    expect(store.raw).toContain(`"regionId":"seoul"`);
  });

  it("does not call the network again inside 30 minutes, then does", async () => {
    const store = memoryStore();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls % 2 === 1) {
        return jsonResponse(forecastBody());
      }
      return jsonResponse(kpBody());
    };
    const first = await loadObservingConditions({
      latitude: USER_LATITUDE,
      longitude: USER_LONGITUDE,
      sunset: SUNSET,
      moonIllumination: 0.31,
      now: NOON,
      store,
      fetchImpl,
    });
    expect(first.ok).toBe(true);
    expect(calls).toBe(2);

    const cached = await loadObservingConditions({
      latitude: USER_LATITUDE,
      longitude: USER_LONGITUDE,
      sunset: SUNSET,
      moonIllumination: 0.9,
      now: new Date(NOON.getTime() + CONDITIONS_CACHE_MS - 1),
      store,
      fetchImpl: async () => {
        throw new Error("cache should answer");
      },
    });
    expect(cached).toMatchObject({ ok: true, fromCache: true, index: 78, kp: 2.33 });

    let refreshed = 0;
    const again = await loadObservingConditions({
      latitude: USER_LATITUDE,
      longitude: USER_LONGITUDE,
      sunset: SUNSET,
      moonIllumination: 0.31,
      now: new Date(NOON.getTime() + CONDITIONS_CACHE_MS),
      store,
      fetchImpl: async (url) => {
        refreshed += 1;
        return jsonResponse(url.includes("open-meteo.com") ? forecastBody() : kpBody());
      },
    });
    expect(refreshed).toBe(2);
    expect(again).toMatchObject({ ok: true, fromCache: false });
  });

  it("keeps a failed request off the cache and survives a store that throws", async () => {
    const store = memoryStore();
    const failed = await loadObservingConditions({
      latitude: USER_LATITUDE,
      longitude: USER_LONGITUDE,
      sunset: SUNSET,
      moonIllumination: 0.31,
      now: NOON,
      store,
      fetchImpl: async (url) => {
        if (url.includes("open-meteo.com")) {
          return jsonResponse(forecastBody());
        }
        return jsonResponse({ error: "down" }, false);
      },
    });
    expect(failed).toMatchObject({ ok: false, reason: "request" });
    expect(store.raw).toBeNull();

    const thrown = await loadObservingConditions({
      latitude: USER_LATITUDE,
      longitude: USER_LONGITUDE,
      sunset: SUNSET,
      moonIllumination: 0.31,
      now: NOON,
      store: {
        getItem() {
          throw new Error("blocked");
        },
        setItem() {
          throw new Error("blocked");
        },
      },
      fetchImpl: async (url) => jsonResponse(url.includes("open-meteo.com") ? forecastBody() : kpBody()),
    });
    expect(thrown.ok).toBe(true);

    const malformed = memoryStore("{");
    const afterBadCache = await loadObservingConditions({
      latitude: USER_LATITUDE,
      longitude: USER_LONGITUDE,
      sunset: SUNSET,
      moonIllumination: 0.31,
      now: NOON,
      store: malformed,
      fetchImpl: async (url) => jsonResponse(url.includes("open-meteo.com") ? forecastBody() : kpBody()),
    });
    expect(afterBadCache).toMatchObject({ ok: true, fromCache: false });
  });

  it("does not send coordinates when the sun does not set", async () => {
    let calls = 0;
    const result = await loadObservingConditions({
      latitude: USER_LATITUDE,
      longitude: USER_LONGITUDE,
      sunset: null,
      moonIllumination: 0.2,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(forecastBody());
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "no-sunset" });
    expect(calls).toBe(0);
  });

  it("fails the card when a request is still open after 5 seconds", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    });
    let settled = false;
    const pending = loadObservingConditions({
      latitude: USER_LATITUDE,
      longitude: USER_LONGITUDE,
      sunset: SUNSET,
      moonIllumination: 0.31,
      now: NOON,
      timeoutMs: 5000,
      fetchImpl,
    }).then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result: ConditionsResult = await pending;
    expect(result).toMatchObject({ ok: false, reason: "request" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("conditions card", () => {
  it("shows the province forecast and leaves the rest of tonight in place", async () => {
    saveLocation(localStorage, {
      latitude: USER_LATITUDE,
      longitude: USER_LONGITUDE,
      label: "서울",
      source: "region",
    });
    const sky = computeTonightSky({ latitude: USER_LATITUDE, longitude: USER_LONGITUDE }, NOON);
    const expectedIndex = observingIndex({
      cloudFraction: 0.2,
      moonIllumination: sky.moonIllumination,
      visibilityKm: 18,
    });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("open-meteo.com")) {
        return jsonResponse(forecastBody());
      }
      if (url.includes("swpc.noaa.gov")) {
        return jsonResponse(kpBody());
      }
      return jsonResponse({ fetched_at: "2026-11-12T03:00:00.000Z", items: [] });
    }));

    document.body.innerHTML = "";
    document.body.append(createApp({ now: () => NOON }));

    await vi.waitFor(() => {
      expect(document.querySelector("#conditions-index")?.textContent).toBe(String(expectedIndex));
    });

    expect(document.querySelector("#conditions-label")?.textContent).toBe("관측 조건 · 서울");
    expect(document.querySelector("#conditions-cloud")?.textContent).toBe("20%");
    expect(document.querySelector("#conditions-visibility")?.textContent).toBe("18 km");
    expect(document.querySelector("#conditions-humidity")?.textContent).toBe("41%");
    expect(document.querySelector("#conditions-kp")?.textContent).toBe("2.33");
    expect(document.querySelector("#summary-index")?.textContent).toBe(String(expectedIndex));
    expect(document.querySelector("#summary-cloud")?.textContent).toBe("20%");
    expect(document.querySelector("#conditions-error")?.hasAttribute("hidden")).toBe(true);
    expect(document.querySelector("#conditions-card")?.textContent).not.toContain("광공해");
    expect(document.querySelector("#conditions-card")?.textContent).not.toContain("보틀");
    expect(document.querySelector("#sunset-value")?.textContent).toBe("17:24");
    expect(document.querySelector("#moon-value")?.textContent).toBe(`${sky.moonIlluminationPercent}%`);

    const weather = calls.find((url) => url.includes("open-meteo.com"));
    expect(weather).toBeDefined();
    const params = new URL(weather ?? "").searchParams;
    expect(params.get("latitude")).toBe(String(seoul().latitude));
    expect(params.get("longitude")).toBe(String(seoul().longitude));
    expect(params.get("latitude")).not.toBe("37.6");
    expect(params.get("longitude")).not.toBe("127");
  });

  it("keeps the error inside the card when the forecast fails", async () => {
    saveLocation(localStorage, {
      latitude: USER_LATITUDE,
      longitude: USER_LONGITUDE,
      label: "서울",
      source: "region",
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("open-meteo.com") || url.includes("swpc.noaa.gov")) {
        throw new Error("offline");
      }
      return jsonResponse({ fetched_at: "2026-11-12T03:00:00.000Z", items: [] });
    }));

    document.body.innerHTML = "";
    document.body.append(createApp({ now: () => NOON }));

    await vi.waitFor(() => {
      expect(document.querySelector("#conditions-error")?.textContent).toBe(
        "관측 조건을 지금 불러올 수 없어요",
      );
    });

    expect((document.querySelector("#conditions-error") as HTMLElement | null)?.hidden).toBe(false);
    expect((document.querySelector("#conditions-rows") as HTMLElement | null)?.hidden).toBe(true);
    expect(document.querySelector("#summary-index")?.textContent).toBe("—");
    expect(document.querySelector("#summary-cloud")?.textContent).toBe("—");
    expect(document.querySelector("#sunset-value")?.textContent).toBe("17:24");
    expect(document.querySelector("#moon-value")?.textContent).toMatch(/%$/);
    expect(document.querySelector("#planet-time")?.textContent).not.toBe("");
  });

  it("skips the cache and the forecast when the nearest office is farther than 400 km", async () => {
    const latitude = 35.7;
    const longitude = 139.7;
    const region = nearestRegion(latitude, longitude);
    const seoul = nearestRegion(37.6, 127);
    expect(region).not.toBeNull();
    expect(seoul?.id).toBe("seoul");
    expect(distanceKm(37.6, 127, seoul!.latitude, seoul!.longitude)).toBeLessThanOrEqual(400);
    expect(distanceKm(latitude, longitude, region!.latitude, region!.longitude)).toBeGreaterThan(400);

    localStorage.setItem(
      CONDITIONS_STORAGE_KEY,
      JSON.stringify({
        regionId: region!.id,
        savedAt: NOON.getTime(),
        index: 61,
        cloudPercent: 13,
        visibilityKm: 20,
        humidityPercent: 40,
        kp: 1,
      }),
    );
    saveLocation(localStorage, {
      latitude,
      longitude,
      label: "Tokyo",
      source: "city",
    });

    const cacheSpy = vi.spyOn(conditions, "readConditionsCache");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({ fetched_at: "2026-11-12T03:00:00.000Z", items: [] });
    }));

    document.body.innerHTML = "";
    document.body.append(createApp({ now: () => NOON }));

    await vi.waitFor(() => {
      expect(document.querySelector("#conditions-error")?.textContent).toBe(
        "이 위치의 관측 조건 예보는 없어요",
      );
    });

    expect(cacheSpy).not.toHaveBeenCalled();
    expect(calls.some((url) => url.includes("open-meteo.com") || url.includes("swpc.noaa.gov"))).toBe(false);
    expect(document.querySelector("#conditions-index")?.textContent).toBe("—");
    expect(document.querySelector("#conditions-cloud")?.textContent).toBe("—");
    expect(document.querySelector("#summary-index")?.textContent).toBe("—");
    expect(document.querySelector("#summary-cloud")?.textContent).toBe("—");
    expect(document.querySelector("#conditions-card")?.textContent).not.toContain("61");
    expect(document.querySelector("#conditions-card")?.textContent).not.toContain("13%");
    expect(document.querySelector("#sunset-value")?.textContent).not.toBe("—");

    document.querySelector<HTMLButtonElement>("#language-button")?.click();
    expect(document.querySelector("#conditions-error")?.textContent).toBe(
      "No observing forecast for this place",
    );
    expect(cacheSpy).not.toHaveBeenCalled();
    expect(calls.some((url) => url.includes("open-meteo.com") || url.includes("swpc.noaa.gov"))).toBe(false);
    expect(document.querySelector("#planet-time")?.textContent).not.toBe("");
  });
});
