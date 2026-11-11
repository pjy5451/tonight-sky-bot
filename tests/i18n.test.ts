import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { en, ko, LANGUAGE_STORAGE_KEY, resolveLanguage, type MessageKey } from "../src/i18n";
import { formatLaunchDateTime } from "../src/launches";
import { saveLocation } from "../src/location";
import { directionSkyLabel, moonPhaseName } from "../src/sky";
import "../src/styles.css";

const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;

function setBrowserLanguage(language: string) {
  Object.defineProperty(navigator, "language", {
    configurable: true,
    value: language,
  });
}

function renderApp(language?: string) {
  if (language) {
    setBrowserLanguage(language);
  }
  document.body.innerHTML = "";
  const app = createApp({ now: () => new Date("2026-11-12T12:00:00.000Z") });
  document.body.append(app);
  return app;
}

function hangulSnippets(root: ParentNode): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? "";
    if (HANGUL.test(text)) {
      found.push(text.trim());
    }
    node = walker.nextNode();
  }
  root.querySelectorAll<HTMLElement>("[aria-label], [title]").forEach((element) => {
    for (const name of ["aria-label", "title"]) {
      const value = element.getAttribute(name) ?? "";
      if (HANGUL.test(value)) {
        found.push(`${name}: ${value}`);
      }
    }
  });
  return found;
}

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dictionaries", () => {
  it("uses the same keys in Korean and English", () => {
    const koreanKeys = Object.keys(ko).sort();
    const englishKeys = Object.keys(en).sort();
    expect(englishKeys).toEqual(koreanKeys);

    for (const key of koreanKeys) {
      const messageKey = key as MessageKey;
      const koreanTokens = ko[messageKey].match(/\{(\w+)\}/g) ?? [];
      const englishTokens = en[messageKey].match(/\{(\w+)\}/g) ?? [];
      expect(englishTokens.sort(), key).toEqual([...koreanTokens].sort());
    }
  });

  it("keeps Hangul out of the English dictionary", () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value, key).not.toMatch(HANGUL);
    }
  });
});

describe("language selection", () => {
  it("follows the browser language on the first visit", () => {
    localStorage.clear();
    expect(resolveLanguage(localStorage, "ko-KR")).toBe("ko");
    expect(resolveLanguage(localStorage, "ko")).toBe("ko");
    expect(resolveLanguage(localStorage, "en-US")).toBe("en");
    expect(resolveLanguage(localStorage, "ja")).toBe("en");

    renderApp("en-US");
    expect(document.documentElement.lang).toBe("en");
    expect(document.querySelector(".eyebrow")?.textContent).toBe("Explore tonight's sky.");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
  });

  it("keeps a saved choice ahead of the browser language", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
    renderApp("ko-KR");
    expect(document.querySelector(".eyebrow")?.textContent).toBe("Explore tonight's sky.");
    expect(document.querySelector("#tab-tonight")?.getAttribute("aria-label")).toBe("Tonight");
  });

  it("switches language with the KO · EN button and stores the choice", () => {
    renderApp("ko-KR");
    expect(document.querySelector(".eyebrow")?.textContent).toBe("오늘 밤, 하늘을 탐험하다");
    expect(document.querySelector("#language-button")?.textContent).toBe("KO · EN");
    expect(document.querySelector("#language-button [data-lang='ko']")?.classList.contains("is-current")).toBe(
      true,
    );

    document.querySelector<HTMLButtonElement>("#language-button")?.click();

    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.querySelector(".eyebrow")?.textContent).toBe("Explore tonight's sky.");
    expect(document.querySelector("#tab-tonight span")?.textContent).toBe("Tonight");
    expect(document.querySelector("#desktop-tab-satellites")?.textContent).toBe("Satellite globe");
    expect(document.querySelector("#language-button [data-lang='en']")?.classList.contains("is-current")).toBe(
      true,
    );

    document.body.innerHTML = "";
    const again = createApp();
    document.body.append(again);
    expect(document.querySelector(".eyebrow")?.textContent).toBe("Explore tonight's sky.");

    document.querySelector<HTMLButtonElement>("#language-button")?.click();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("ko");
    expect(document.querySelector(".eyebrow")?.textContent).toBe("오늘 밤, 하늘을 탐험하다");
  });
});

describe("English screen", () => {
  it("shows directions, dates, and times in English and leaves no Hangul", async () => {
    saveLocation(localStorage, {
      latitude: 37.6,
      longitude: 127,
      label: "서울",
      source: "region",
    });
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("launches.json")) {
          return {
            ok: true,
            json: async () => ({
              fetched_at: "2026-11-12T03:00:00.000Z",
              items: [
                {
                  id: "starlink",
                  name: "Falcon 9 | Starlink",
                  net: "2026-11-14T12:05:41Z",
                  provider: "SpaceX",
                  rocket: "Falcon 9",
                  location: "Cape Canaveral",
                  webcast_urls: [],
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({ fetched_at: "2026-11-12T03:00:00.000Z", items: [] }),
        };
      }),
    );

    renderApp("ko-KR");
    document.querySelector<HTMLButtonElement>("#tab-launches")?.click();

    expect(document.querySelector("#location-label")?.textContent).toBe("Seoul");
    expect(document.querySelector("#region-seoul")?.textContent).toBe("Seoul");
    expect(document.querySelector(".planet-name")?.textContent).toBe("Saturn");
    expect(document.querySelector(".planet-detail")?.textContent).toBe("SSE sky");
    expect(document.querySelector("#moon-phase-name")?.textContent).toBe("Waxing crescent");
    expect(document.querySelector("#sunset-value")?.textContent).toBe("17:24");
    expect(document.querySelector("#meteor-name")?.textContent).toBe("Leonids peak");
    expect(directionSkyLabel("남남동", "en")).toBe("SSE sky");
    expect(moonPhaseName(19.3, 3, "en")).toBe("Waxing crescent");
    expect(formatLaunchDateTime(new Date("2026-11-14T12:05:41Z"), "en")).toBe("11/14 (Sat) 21:05");

    await vi.waitFor(() => {
      expect(document.querySelector("#next-launch-when")?.textContent).toBe("11/14 (Sat) 21:05");
    });
    expect(document.querySelector("#launch-countdown .stat-label")?.textContent).toBe("Day");

    expect(hangulSnippets(document.body)).toEqual([]);
  });
});
