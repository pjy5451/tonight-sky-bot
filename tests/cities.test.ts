import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { matchingCities, parseCities, type CityRecord } from "../src/cities";
import { LANGUAGE_STORAGE_KEY } from "../src/i18n";
import { loadLocation, roundToTenth, saveLocation, type KeyValueStore } from "../src/location";
import { DATA_FILES } from "../scripts/fetch-data.js";
import "../src/styles.css";

const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem(key) {
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
  };
}

function loadCityFile(): CityRecord[] {
  const payload: unknown = JSON.parse(new TextDecoder().decode(readFileSync("public/data/cities.json")));
  return parseCities(payload);
}

function tokyoRow(cities: readonly CityRecord[]): CityRecord {
  const rows = cities.filter(
    (city) => city.country === "JP" && city.featureCode === "PPLC" && city.asciiname === "Tokyo",
  );
  expect(rows).toHaveLength(1);
  const tokyo = rows[0];
  if (!tokyo) {
    throw new Error("Tokyo row is missing");
  }
  return tokyo;
}

function visibleCopy(root: ParentNode): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    found.push(node.textContent ?? "");
    node = walker.nextNode();
  }
  root.querySelectorAll<HTMLElement>("[aria-label], [title]").forEach((element) => {
    for (const name of ["aria-label", "title"]) {
      const value = element.getAttribute(name);
      if (value) {
        found.push(value);
      }
    }
  });
  return found;
}

function setCityQuery(value: string): void {
  const input = document.querySelector<HTMLInputElement>("#city-search");
  if (!input) {
    throw new Error("city search is missing");
  }
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("city catalog", () => {
  it("stores Tokyo from the file and keeps cities out of the data refresh", () => {
    const bytes = readFileSync("public/data/cities.json");
    expect(bytes.byteLength).toBeLessThanOrEqual(250 * 1024);
    const cities = loadCityFile();
    const tokyo = tokyoRow(cities);
    expect(tokyo.ko.length).toBeGreaterThan(0);

    const store = memoryStore();
    const saved = saveLocation(store, {
      latitude: tokyo.lat,
      longitude: tokyo.lon,
      label: tokyo.asciiname,
      source: "city",
    });
    expect(saved).toEqual({
      latitude: roundToTenth(tokyo.lat),
      longitude: roundToTenth(tokyo.lon),
      label: "Tokyo",
      source: "city",
    });
    expect(loadLocation(store)).toEqual(saved);

    expect(() =>
      saveLocation(store, {
        latitude: tokyo.lat,
        longitude: tokyo.lon,
        label: tokyo.asciiname,
        source: "server" as "city",
      }),
    ).toThrow(RangeError);

    expect(matchingCities(cities, "   ")).toEqual([]);
    expect(matchingCities(cities, "tokyo").some((city) => city.asciiname === "Tokyo")).toBe(true);
    expect(matchingCities(cities, tokyo.ko).some((city) => city.asciiname === "Tokyo")).toBe(true);

    expect(DATA_FILES).not.toContain("cities.json");
    const workflow = new TextDecoder().decode(readFileSync(".github/workflows/data-refresh.yml"));
    expect(workflow).not.toContain("cities.json");
    const readme = new TextDecoder().decode(readFileSync("README.md"));
    expect(readme).toContain("GeoNames");
    expect(readme).toContain("cities5000");
    expect(readme).toContain("alternateNamesV2");
    expect(readme).toContain("CC BY 4.0");
    expect(new TextDecoder().decode(readFileSync("src/app.ts"))).not.toContain("geonames.org");
    expect(new TextDecoder().decode(readFileSync("src/cities.ts"))).not.toContain("geonames.org");
  });
});

describe("city search", () => {
  function installCities(cities: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("cities.json")) {
          return { ok: true, json: async () => cities };
        }
        return { ok: true, json: async () => ({ fetched_at: "2026-11-12T03:00:00.000Z", items: [] }) };
      }),
    );
  }

  it("shows only the ascii name for tokyo on an English screen", async () => {
    const cities = loadCityFile();
    const tokyo = tokyoRow(cities);
    installCities(JSON.parse(new TextDecoder().decode(readFileSync("public/data/cities.json"))));
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");

    document.body.innerHTML = "";
    document.body.append(createApp({ now: () => new Date("2026-11-12T03:00:00.000Z") }));
    setCityQuery("tokyo");

    await vi.waitFor(() => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>("#city-results button")];
      expect(buttons.some((button) => button.textContent === "Tokyo")).toBe(true);
    });

    const buttons = [...document.querySelectorAll<HTMLButtonElement>("#city-results button")];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.textContent).toBe(button.textContent?.trim());
      expect(button.textContent).not.toMatch(HANGUL);
      expect(button.getAttribute("title")).toBeNull();
    }
    expect(document.querySelector("#city-results")?.textContent).not.toContain(tokyo.ko);
    expect(document.querySelector("#region-seoul")?.textContent).toBe("Seoul");

    setCityQuery("   ");
    expect(document.querySelectorAll("#city-results li")).toHaveLength(0);

    setCityQuery("tokyo");
    document.querySelector<HTMLButtonElement>("#city-results button")?.click();

    expect(document.querySelector("#location-label")?.textContent).toBe("Tokyo");
    expect(loadLocation(localStorage)).toEqual({
      latitude: roundToTenth(tokyo.lat),
      longitude: roundToTenth(tokyo.lon),
      label: "Tokyo",
      source: "city",
    });
    expect(visibleCopy(document.body).join("\n")).not.toContain(tokyo.ko);
  });

  it("selects Tokyo from the Korean name without placing that name on the page", async () => {
    const cities = loadCityFile();
    const tokyo = tokyoRow(cities);
    installCities(JSON.parse(new TextDecoder().decode(readFileSync("public/data/cities.json"))));
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");

    document.body.innerHTML = "";
    document.body.append(createApp({ now: () => new Date("2026-11-12T03:00:00.000Z") }));
    setCityQuery(tokyo.ko);

    await vi.waitFor(() => {
      expect(document.querySelector("#city-results button")?.textContent).toBe("Tokyo");
    });
    expect(document.querySelector("#city-results")?.textContent).toBe("Tokyo");
    expect(document.querySelector("#city-results")?.textContent).not.toContain(tokyo.ko);

    document.querySelector<HTMLButtonElement>("#city-results button")?.click();
    expect(loadLocation(localStorage)?.source).toBe("city");
    expect(loadLocation(localStorage)?.label).toBe("Tokyo");
    const copy = visibleCopy(document.body).join("\n");
    expect(copy).not.toContain(tokyo.ko);
    for (const element of document.querySelectorAll<HTMLElement>("[aria-label], [title]")) {
      expect(element.getAttribute("aria-label") ?? "").not.toContain(tokyo.ko);
      expect(element.getAttribute("title") ?? "").not.toContain(tokyo.ko);
    }
  });
});
