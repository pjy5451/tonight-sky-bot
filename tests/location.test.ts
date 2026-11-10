import { describe, expect, it } from "vitest";
import {
  LOCATION_STORAGE_KEY,
  REGIONS,
  geolocationErrorMessage,
  loadLocation,
  roundToTenth,
  saveLocation,
  type KeyValueStore,
} from "../src/location";

function createMemoryStore(): KeyValueStore & { raw(): string | null } {
  const data = new Map<string, string>();
  return {
    getItem(key) {
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    raw() {
      return data.get(LOCATION_STORAGE_KEY) ?? null;
    },
  };
}

describe("roundToTenth", () => {
  it("rounds half away from zero to one decimal place", () => {
    expect(roundToTenth(35.15)).toBe(35.2);
    expect(roundToTenth(35.14)).toBe(35.1);
    expect(roundToTenth(1.25)).toBe(1.3);
    expect(roundToTenth(1.24)).toBe(1.2);
    expect(roundToTenth(0.05)).toBe(0.1);
    expect(roundToTenth(0.04)).toBe(0);
    expect(roundToTenth(-1.25)).toBe(-1.3);
    expect(roundToTenth(9.95)).toBe(10);
  });

  it("rounds the published Seoul city hall coordinates", () => {
    const seoul = REGIONS.find((region) => region.id === "seoul");
    expect(seoul).toBeDefined();
    expect(roundToTenth(seoul!.latitude)).toBe(37.6);
    expect(roundToTenth(seoul!.longitude)).toBe(127);
  });

  it("rejects values that are not finite", () => {
    expect(() => roundToTenth(Number.NaN)).toThrow(RangeError);
    expect(() => roundToTenth(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("saveLocation and loadLocation", () => {
  it("stores rounded coordinates and reads them back", () => {
    const store = createMemoryStore();
    const seoul = REGIONS.find((region) => region.id === "seoul");
    expect(seoul).toBeDefined();

    const saved = saveLocation(store, {
      latitude: seoul!.latitude,
      longitude: seoul!.longitude,
      label: seoul!.shortName,
      source: "region",
    });

    expect(saved).toEqual({
      latitude: 37.6,
      longitude: 127,
      label: "서울",
      source: "region",
    });
    expect(loadLocation(store)).toEqual(saved);
    expect(store.raw()).toBe(JSON.stringify(saved));
    expect(store.raw()).not.toContain("37.566");
    expect(store.raw()).not.toContain("126.977");
  });

  it("returns null when nothing is stored", () => {
    expect(loadLocation(createMemoryStore())).toBeNull();
  });

  it("drops malformed, out-of-range, and full-precision values", () => {
    const store = createMemoryStore();

    store.setItem(LOCATION_STORAGE_KEY, "not-json");
    expect(loadLocation(store)).toBeNull();

    store.setItem(
      LOCATION_STORAGE_KEY,
      JSON.stringify({
        latitude: 37.56640556,
        longitude: 126.97782222,
        label: "서울",
        source: "region",
      }),
    );
    expect(loadLocation(store)).toBeNull();

    store.setItem(
      LOCATION_STORAGE_KEY,
      JSON.stringify({
        latitude: 95,
        longitude: 127,
        label: "서울",
        source: "region",
      }),
    );
    expect(loadLocation(store)).toBeNull();

    store.setItem(
      LOCATION_STORAGE_KEY,
      JSON.stringify({
        latitude: 37.6,
        longitude: 127,
        label: "서울",
        source: "server",
      }),
    );
    expect(loadLocation(store)).toBeNull();
  });

  it("does not write a coordinate outside the valid range", () => {
    const store = createMemoryStore();

    expect(() =>
      saveLocation(store, {
        latitude: 95,
        longitude: 127,
        label: "서울",
        source: "region",
      }),
    ).toThrow(RangeError);
    expect(store.raw()).toBeNull();
  });
});

describe("region list", () => {
  it("lists the 17 first-level regions with hall coordinates in Korea", () => {
    expect(REGIONS).toHaveLength(17);
    expect(new Set(REGIONS.map((region) => region.id)).size).toBe(17);
    expect(new Set(REGIONS.map((region) => region.shortName)).size).toBe(17);

    for (const region of REGIONS) {
      expect(region.latitude).toBeGreaterThan(33);
      expect(region.latitude).toBeLessThan(39);
      expect(region.longitude).toBeGreaterThan(124);
      expect(region.longitude).toBeLessThan(132);
      expect(() => roundToTenth(region.latitude)).not.toThrow();
      expect(() => roundToTenth(region.longitude)).not.toThrow();
    }
  });
});

describe("geolocationErrorMessage", () => {
  it("explains a denied permission and keeps the next step on the device", () => {
    expect(geolocationErrorMessage(1)).toBe("위치 권한을 허용하지 않았습니다. 시·도를 선택해 주세요.");
    expect(geolocationErrorMessage(2)).toContain("시·도");
    expect(geolocationErrorMessage(3)).toContain("시·도");
    expect(geolocationErrorMessage(0)).toContain("시·도");
  });
});
