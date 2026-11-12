import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EquatorFromVector,
  Horizon,
  Observer,
  RotateVector,
  Rotation_EQJ_EQD,
  Spherical,
  VectorFromSphere,
} from "astronomy-engine";
import { createApp } from "../src/app";
import { saveLocation } from "../src/location";
import {
  bearingAfterDrag,
  createSkyMap,
  headingFromOrientation,
  horizontalFromJ2000,
  parseStarCatalog,
  projectAllSky,
  type StarCatalog,
} from "../src/sky-map";
import "../src/styles.css";

declare const process: {
  cwd(): string;
};

const SEOUL = { latitude: 37.6, longitude: 127 };
const NIGHT = new Date("2026-11-12T12:00:00.000Z");

function loadCatalog(): { bytes: Uint8Array; catalog: StarCatalog } {
  const bytes = readFileSync(join(process.cwd(), "public/data/stars.json"));
  const catalog = parseStarCatalog(JSON.parse(new TextDecoder().decode(bytes)));
  if (!catalog) {
    throw new Error("stars.json을 읽지 못했습니다.");
  }
  return { bytes, catalog };
}

function referenceHorizontal(raHours: number, decDeg: number): { azimuth: number; altitude: number } {
  const observer = new Observer(SEOUL.latitude, SEOUL.longitude, 0);
  const raDegrees = ((raHours * 15) % 360 + 360) % 360;
  const j2000 = VectorFromSphere(new Spherical(decDeg, raDegrees, 1), NIGHT);
  const ofDate = RotateVector(Rotation_EQJ_EQD(NIGHT), j2000);
  const equatorial = EquatorFromVector(ofDate);
  const horizontal = Horizon(NIGHT, observer, equatorial.ra, equatorial.dec, "normal");
  return { azimuth: horizontal.azimuth, altitude: horizontal.altitude };
}

function angleDelta(actual: number, expected: number): number {
  return Math.abs((((actual - expected) % 360) + 540) % 360 - 180);
}

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("star catalog", () => {
  it("keeps the public-domain list at magnitude 5.5 and under 300KB", () => {
    const { bytes, catalog } = loadCatalog();
    expect(bytes.byteLength).toBeLessThanOrEqual(300 * 1024);
    expect(bytes.byteLength).toBeGreaterThan(10_000);
    expect(catalog.stars.length).toBeGreaterThan(1000);
    expect(catalog.lines.length).toBeGreaterThan(0);
    for (const star of catalog.stars) {
      expect(star.mag).toBeLessThanOrEqual(5.5);
      expect(star.raHours).toBeGreaterThanOrEqual(0);
      expect(star.raHours).toBeLessThan(24);
    }
    const brightest = catalog.stars.reduce((best, star) => (star.mag < best.mag ? star : best));
    expect(brightest.hr).toBe(2491);
    expect(brightest.mag).toBeLessThan(0);
  });
});

describe("equatorial to horizontal", () => {
  it("matches astronomy-engine within half a degree", () => {
    const { catalog } = loadCatalog();
    const brightest = catalog.stars.reduce((best, star) => (star.mag < best.mag ? star : best));
    const samples = [
      { raHours: brightest.raHours, decDeg: brightest.decDeg },
      { raHours: 12, decDeg: 45 },
      { raHours: 0.25, decDeg: -40 },
      { raHours: 18.6, decDeg: 38.8 },
    ];
    for (const sample of samples) {
      const actual = horizontalFromJ2000(NIGHT, SEOUL, sample.raHours, sample.decDeg);
      const expected = referenceHorizontal(sample.raHours, sample.decDeg);
      expect(angleDelta(actual.azimuth, expected.azimuth)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(actual.altitude - expected.altitude)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("all-sky projection and drag", () => {
  it("puts north at the top, east at the right, and the zenith in the center", () => {
    const north = projectAllSky(0, 0, 10);
    const east = projectAllSky(90, 0, 10);
    const zenith = projectAllSky(180, 90, 40);
    expect(north).not.toBeNull();
    expect(east).not.toBeNull();
    expect(zenith).toEqual({ x: 0, y: 0 });
    expect(north?.x ?? 1).toBeCloseTo(0, 5);
    expect(north?.y ?? 0).toBeLessThan(0);
    expect(east?.y ?? 1).toBeCloseTo(0, 5);
    expect(east?.x ?? 0).toBeGreaterThan(0);
    expect(projectAllSky(20, -0.1, 10)).toBeNull();
  });

  it("turns the bearing when the chart is dragged and there is no sensor reading", () => {
    expect(bearingAfterDrag(0, 80, 320)).toBe(315);
    expect(bearingAfterDrag(10, 0, 200)).toBe(10);
    expect(headingFromOrientation({ alpha: 90, absolute: false, webkitCompassHeading: null })).toBeNull();
    expect(headingFromOrientation({ alpha: 20, absolute: false, webkitCompassHeading: 90 })).toBe(90);
    expect(headingFromOrientation({ alpha: 90, absolute: true, webkitCompassHeading: null })).toBe(270);

    const map = createSkyMap();
    document.body.append(map.element);
    map.update({
      locale: "ko",
      place: SEOUL,
      date: NIGHT,
      stars: null,
      starStatus: "loading",
      issTrack: [],
    });
    const svg = map.element.querySelector("#sky-map-svg");
    expect(svg).toBeInstanceOf(SVGElement);
    if (!(svg instanceof SVGElement)) {
      return;
    }
    expect(svg.getAttribute("data-view-bearing")).toBe("0.0");
    expect(svg.querySelectorAll(".sky-cardinal").length).toBe(4);
    expect(map.element.querySelector("#sky-map-point")?.getAttribute("aria-pressed")).toBe("false");

    svg.dispatchEvent(new PointerEvent("pointerdown", { clientX: 20, clientY: 40, pointerId: 1, bubbles: true }));
    svg.dispatchEvent(new PointerEvent("pointermove", { clientX: 100, clientY: 40, pointerId: 1, bubbles: true }));
    const expected = bearingAfterDrag(0, 80, svg.getBoundingClientRect().width);
    expect(Number(svg.getAttribute("data-view-bearing"))).toBeCloseTo(expected, 1);
    expect(svg.getAttribute("data-view-bearing")).not.toBe("0.0");
  });

  it("follows an absolute orientation event after the button asks for the sensor", () => {
    const map = createSkyMap();
    document.body.append(map.element);
    map.update({
      locale: "en",
      place: SEOUL,
      date: NIGHT,
      stars: null,
      starStatus: "ready",
      issTrack: [],
    });
    map.element.querySelector<HTMLButtonElement>("#sky-map-point")?.click();
    expect(map.element.querySelector("#sky-map-point")?.getAttribute("aria-pressed")).toBe("true");
    window.dispatchEvent(
      new DeviceOrientationEvent("deviceorientationabsolute", {
        alpha: 90,
        beta: 0,
        gamma: 0,
        absolute: true,
      }),
    );
    expect(map.element.querySelector("#sky-map-svg")?.getAttribute("data-view-bearing")).toBe("270.0");
    expect(map.element.querySelector("#sky-map-note")?.textContent).toBe(
      "The chart turns toward the top of the device.",
    );
  });
});

const SENSOR_DENIED = "방향 센서를 쓸 수 없습니다. 끌어 돌리세요.";

function installCompassPermission(impl: (this: unknown, ...args: unknown[]) => Promise<string>): {
  calls: Array<{ receiver: unknown; args: unknown[] }>;
  restore: () => void;
} {
  const original = globalThis.DeviceOrientationEvent;
  const calls: Array<{ receiver: unknown; args: unknown[] }> = [];
  const fake = function FakeDeviceOrientationEvent(
    this: unknown,
    type: string,
    init?: DeviceOrientationEventInit,
  ) {
    return new original(type, init);
  };
  Object.defineProperty(fake, "requestPermission", {
    configurable: true,
    writable: true,
    value(this: unknown, ...args: unknown[]) {
      calls.push({ receiver: this, args });
      return impl.apply(this, args);
    },
  });
  Object.defineProperty(globalThis, "DeviceOrientationEvent", {
    configurable: true,
    writable: true,
    value: fake,
  });
  return {
    calls,
    restore() {
      Object.defineProperty(globalThis, "DeviceOrientationEvent", {
        configurable: true,
        writable: true,
        value: original,
      });
    },
  };
}

function mountSkyMap(): { map: ReturnType<typeof createSkyMap>; button: HTMLButtonElement; svg: SVGElement } {
  const map = createSkyMap();
  document.body.append(map.element);
  map.update({
    locale: "ko",
    place: SEOUL,
    date: NIGHT,
    stars: null,
    starStatus: "ready",
    issTrack: [],
  });
  const button = map.element.querySelector<HTMLButtonElement>("#sky-map-point");
  const svg = map.element.querySelector<SVGElement>("#sky-map-svg");
  if (!button || !svg) {
    throw new Error("하늘 지도 버튼이나 그림을 찾지 못했습니다.");
  }
  return { map, button, svg };
}

function dragChart(svg: SVGElement): void {
  svg.dispatchEvent(new PointerEvent("pointerdown", { clientX: 20, clientY: 40, pointerId: 1, bubbles: true }));
  svg.dispatchEvent(new PointerEvent("pointermove", { clientX: 100, clientY: 40, pointerId: 1, bubbles: true }));
}

describe("iOS compass permission", () => {
  it("calls requestPermission on the constructor with true, then follows webkitCompassHeading", async () => {
    let resolvePermission: (value: string) => void = () => {};
    const permission = new Promise<string>((resolve) => {
      resolvePermission = resolve;
    });
    const sensor = installCompassPermission(() => permission);
    try {
      const { map, button } = mountSkyMap();
      button.click();
      expect(sensor.calls).toHaveLength(1);
      expect(sensor.calls[0]?.receiver).toBe(globalThis.DeviceOrientationEvent);
      expect(sensor.calls[0]?.args[0]).toBe(true);
      expect(button.getAttribute("aria-pressed")).toBe("false");

      resolvePermission("granted");
      await permission;
      await Promise.resolve();

      const reading = new Event("deviceorientation");
      Object.defineProperties(reading, {
        webkitCompassHeading: { value: 90 },
        absolute: { value: false },
        alpha: { value: 12 },
      });
      window.dispatchEvent(reading);
      expect(map.element.querySelector("#sky-map-svg")?.getAttribute("data-view-bearing")).toBe("90.0");
    } finally {
      sensor.restore();
    }
  });

  it("keeps drag working when permission is denied", async () => {
    let resolvePermission: (value: string) => void = () => {};
    const permission = new Promise<string>((resolve) => {
      resolvePermission = resolve;
    });
    const sensor = installCompassPermission(() => permission);
    try {
      const { map, button, svg } = mountSkyMap();
      expect(() => button.click()).not.toThrow();
      expect(sensor.calls[0]?.receiver).toBe(globalThis.DeviceOrientationEvent);
      expect(sensor.calls[0]?.args[0]).toBe(true);
      resolvePermission("denied");
      await permission;
      await Promise.resolve();
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(map.element.querySelector("#sky-map-note")?.textContent).toBe(SENSOR_DENIED);
      expect(svg.getAttribute("data-view-bearing")).toBe("0.0");
      dragChart(svg);
      expect(svg.getAttribute("data-view-bearing")).not.toBe("0.0");
    } finally {
      sensor.restore();
    }
  });

  it("keeps drag working when the permission promise rejects", async () => {
    const sensor = installCompassPermission(
      () => Promise.reject(new Error("denied")),
    );
    try {
      const { map, button, svg } = mountSkyMap();
      expect(() => button.click()).not.toThrow();
      expect(sensor.calls[0]?.receiver).toBe(globalThis.DeviceOrientationEvent);
      expect(sensor.calls[0]?.args[0]).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(map.element.querySelector("#sky-map-note")?.textContent).toBe(SENSOR_DENIED);
      dragChart(svg);
      expect(svg.getAttribute("data-view-bearing")).not.toBe("0.0");
    } finally {
      sensor.restore();
    }
  });

  it("shows the sensor message and still drags when requestPermission throws", () => {
    const sensor = installCompassPermission(() => {
      throw new Error("permission unavailable");
    });
    try {
      const { map, button, svg } = mountSkyMap();
      expect(() => button.click()).not.toThrow();
      expect(sensor.calls[0]?.receiver).toBe(globalThis.DeviceOrientationEvent);
      expect(sensor.calls[0]?.args[0]).toBe(true);
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(map.element.querySelector("#sky-map-note")?.textContent).toBe(SENSOR_DENIED);
      expect(svg.getAttribute("data-view-bearing")).toBe("0.0");
      dragChart(svg);
      expect(svg.getAttribute("data-view-bearing")).not.toBe("0.0");
    } finally {
      sensor.restore();
    }
  });
});

describe("tonight tab placement", () => {
  it("draws the round chart at the top of tonight and hides it until a place is chosen", () => {
    document.body.append(createApp({ now: () => NIGHT }));
    const board = document.querySelector("#panel-tonight .board");
    expect(board?.firstElementChild?.id).toBe("sky-map");
    expect(document.querySelector("#sky-map-svg")?.hasAttribute("hidden")).toBe(true);
    expect(document.querySelector("#sky-map-note")?.textContent).toBe("위치를 선택하면 하늘 지도를 그립니다.");
    expect(document.querySelector("#panel-tonight")?.textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("plots catalog stars, constellation lines, and a planet once a place is set", () => {
    const { catalog } = loadCatalog();
    saveLocation(localStorage, {
      latitude: SEOUL.latitude,
      longitude: SEOUL.longitude,
      label: "서울",
      source: "region",
    });
    const map = createSkyMap();
    document.body.append(map.element);
    map.update({
      locale: "ko",
      place: SEOUL,
      date: NIGHT,
      stars: catalog,
      starStatus: "ready",
      issTrack: [
        {
          time: new Date("2026-11-12T12:10:00.000Z"),
          azimuth: 140,
          elevation: 30,
          mark: true,
        },
        {
          time: new Date("2026-11-12T12:12:00.000Z"),
          azimuth: 160,
          elevation: 40,
          mark: false,
        },
        {
          time: new Date("2026-11-12T12:14:00.000Z"),
          azimuth: 190,
          elevation: 20,
          mark: true,
        },
      ],
    });
    expect(map.element.querySelectorAll(".sky-star").length).toBeGreaterThan(50);
    expect(map.element.querySelectorAll(".sky-line").length).toBeGreaterThan(10);
    expect(map.element.querySelector(".sky-planet-saturn")).not.toBeNull();
    expect(map.element.querySelectorAll(".sky-tick-label").length).toBe(2);
    const labels = [...map.element.querySelectorAll(".sky-tick-label")].map((node) => node.textContent);
    expect(labels).toEqual(["21:10", "21:14"]);
    expect(map.element.querySelector(".sky-iss")).not.toBeNull();
  });
});
