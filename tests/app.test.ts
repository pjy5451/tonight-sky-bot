import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { LOCATION_STORAGE_KEY } from "../src/location";
import indexHtml from "../index.html?raw";
import manifestText from "../public/manifest.webmanifest?raw";
import "../src/styles.css";

function renderApp() {
  document.body.innerHTML = "";
  const app = createApp();
  document.body.append(app);
  return app;
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
    expect(JSON.parse(localStorage.getItem(LOCATION_STORAGE_KEY) ?? "{}")).toMatchObject({
      latitude: 35.2,
      longitude: 129.1,
      label: "부산",
      source: "region",
    });
  });
});

describe("Argonova frame", () => {
  it("sets the page title, manifest name, and tagline to Argonova", () => {
    const html = indexHtml;
    const manifest = JSON.parse(manifestText) as {
      name: string;
      short_name: string;
    };

    expect(html).toContain("<title>Argonova</title>");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain("fonts.googleapis.com");
    expect(html).toContain("Noto+Sans+KR");
    expect(html).toContain("Space+Grotesk");
    expect(manifest.name).toBe("Argonova");
    expect(manifest.short_name).toBe("Argonova");

    renderApp();
    expect(document.title).toBe("Argonova");
    expect(document.querySelector("h1")?.textContent).toBe("Argonova");
    expect(document.querySelector(".eyebrow")?.textContent).toBe("오늘 밤, 하늘을 탐험하다");
    expect(getComputedStyle(document.body).fontFamily).toContain("Noto Sans KR");
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
    expect(barStyle.backgroundColor).toBe("rgb(14, 20, 40)");

    expect(getComputedStyle(document.querySelector("#tab-tonight") as HTMLElement).color).toBe(
      "rgb(245, 181, 68)",
    );
    expect(getComputedStyle(document.querySelector("#tab-launches") as HTMLElement).color).toBe(
      "rgb(169, 179, 199)",
    );

    document.querySelector<HTMLButtonElement>("#tab-launches")?.click();
    expect(getComputedStyle(document.querySelector("#tab-launches") as HTMLElement).color).toBe(
      "rgb(245, 181, 68)",
    );
  });

  it("uses mockup card shapes with a pending label and no sample times", () => {
    renderApp();

    const tonight = document.querySelector("#panel-tonight");
    expect(tonight?.querySelector(".stat-grid")).not.toBeNull();
    expect(tonight?.querySelector(".card-highlight")).not.toBeNull();
    expect(tonight?.textContent).toContain("일몰");
    expect(tonight?.textContent).toContain("ISS 통과");
    expect(tonight?.textContent).toContain("준비 중");
    expect(tonight?.textContent).not.toMatch(/\d{1,2}:\d{2}/);

    document.querySelector<HTMLButtonElement>("#tab-satellites")?.click();
    const satellites = document.querySelector("#panel-satellites");
    expect(satellites?.querySelector(".globe-placeholder")).not.toBeNull();
    expect(satellites?.querySelector(".legend")).not.toBeNull();
    expect(satellites?.querySelector(".card-highlight")).not.toBeNull();
    expect(satellites?.textContent).toContain("준비 중");

    document.querySelector<HTMLButtonElement>("#tab-launches")?.click();
    const launches = document.querySelector("#panel-launches");
    expect(launches?.querySelector(".countdown")).not.toBeNull();
    expect(launches?.querySelectorAll(".countdown-cell")).toHaveLength(4);
    expect(launches?.querySelector(".card-highlight")).not.toBeNull();
    expect(launches?.textContent).toContain("다음 발사");
    expect(launches?.textContent).toContain("준비 중");
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
