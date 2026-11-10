import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { LOCATION_STORAGE_KEY } from "../src/location";

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
