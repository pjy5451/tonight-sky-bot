import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ShaderLib } from "three";
import {
  EARTH_BUMP_SCALE,
  EarthTextureSchedule,
  ZOOM_IN_ALTITUDE,
  anisotropyLevel,
  photoEdgeFor,
  startupTextures,
} from "../src/earth-textures";
import {
  PHONG_OUTGOING_LIGHT,
  SUNLIGHT_REFRESH_MS,
  patchDayNightFragmentShader,
  sunDirectionFromSubsolar,
} from "../src/globe-view";
import globeSource from "../src/globe-view.ts?raw";

const MAX_TEXTURE_BYTES = 600 * 1024;
const TEXTURES = ["public/textures/earth-day.jpg", "public/textures/earth-night.jpg"] as const;

function readU16(bytes: Uint8Array, offset: number): number {
  const hi = bytes[offset] ?? 0;
  const lo = bytes[offset + 1] ?? 0;
  return (hi << 8) | lo;
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("JPEG가 아닙니다.");
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      break;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0x00 || marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = readU16(bytes, offset + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return {
        height: readU16(bytes, offset + 5),
        width: readU16(bytes, offset + 7),
      };
    }
    if (marker === 0xda || length < 2) {
      break;
    }
    offset += 2 + length;
  }
  throw new Error("JPEG 크기를 찾지 못했습니다.");
}

describe("earth day and night textures", () => {
  it("ships 2048×1024 JPEGs of at most 600KB and drops the placeholder", () => {
    expect(() => statSync("public/textures/earth.png")).toThrow();
    for (const path of TEXTURES) {
      const bytes = readFileSync(path);
      expect(bytes.byteLength).toBeGreaterThan(0);
      expect(bytes.byteLength).toBeLessThanOrEqual(MAX_TEXTURE_BYTES);
      expect(jpegSize(bytes)).toEqual({ width: 2048, height: 1024 });
    }
  });
});

describe("day-night globe shader", () => {
  it("refreshes the subsolar direction once a minute", () => {
    expect(SUNLIGHT_REFRESH_MS).toBe(60_000);
    expect(globeSource).toContain("SUNLIGHT_REFRESH_MS");
    expect(globeSource).toContain("setInterval");
  });

  it("points the sun at the same axes as the globe mesh", () => {
    const equator = sunDirectionFromSubsolar(0, 0);
    expect(equator.x).toBeCloseTo(0);
    expect(equator.y).toBeCloseTo(0);
    expect(equator.z).toBeCloseTo(1);
    const north = sunDirectionFromSubsolar(90, 0);
    expect(north.x).toBeCloseTo(0);
    expect(north.y).toBeCloseTo(1);
    expect(north.z).toBeCloseTo(0);
    const east = sunDirectionFromSubsolar(0, 90);
    expect(east.x).toBeCloseTo(1);
    expect(east.y).toBeCloseTo(0);
    expect(east.z).toBeCloseTo(0);
    const sample = sunDirectionFromSubsolar(23.4, -128);
    expect(Math.hypot(sample.x, sample.y, sample.z)).toBeCloseTo(1);
  });

  it("patches the installed MeshPhong shader with a soft day-night mix", () => {
    const patched = patchDayNightFragmentShader(ShaderLib.phong.fragmentShader);
    const normalAt = patched.indexOf("#include <normal_fragment_begin>");
    const sunAt = patched.indexOf("float sunDot");
    expect(normalAt).toBeGreaterThan(-1);
    expect(sunAt).toBeGreaterThan(normalAt);
    const bumpAt = patched.indexOf("#include <normal_fragment_maps>");
    expect(bumpAt).toBeGreaterThan(normalAt);
    expect(sunAt).toBeGreaterThan(bumpAt);
    expect(patched).toContain("uniform vec3 uSunDirection");
    expect(patched).toContain("smoothstep(-0.12, 0.28, sunDot)");
    expect(patched).toContain("float relief = clamp(0.62 + 0.48 * sunDot, 0.4, 1.2)");
    expect(patched).toContain("#ifdef USE_SPECULARMAP");
    expect(patched).toContain("specularStrength");
    expect(patched).toContain("mix(totalEmissiveRadiance, dayColor, dayFactor)");
    expect(patched).not.toContain(PHONG_OUTGOING_LIGHT);
  });
});

const HIGH_RES_DAY_LIMIT = 6 * 1024 * 1024;

describe("sharper earth textures", () => {
  it("ships an 8192×4096 day photo of at most 6MB, plus matching night and 4K sizes", () => {
    const day8k = readFileSync("public/textures/earth-day-8k.jpg");
    const night8k = readFileSync("public/textures/earth-night-8k.jpg");
    const day4k = readFileSync("public/textures/earth-day-4k.jpg");
    const night4k = readFileSync("public/textures/earth-night-4k.jpg");
    expect(jpegSize(day8k)).toEqual({ width: 8192, height: 4096 });
    expect(day8k.byteLength).toBeGreaterThan(MAX_TEXTURE_BYTES);
    expect(day8k.byteLength).toBeLessThanOrEqual(HIGH_RES_DAY_LIMIT);
    expect(jpegSize(night8k)).toEqual({ width: 8192, height: 4096 });
    expect(night8k.byteLength).toBeGreaterThan(0);
    expect(night8k.byteLength).toBeLessThanOrEqual(HIGH_RES_DAY_LIMIT);
    expect(jpegSize(day4k)).toEqual({ width: 4096, height: 2048 });
    expect(jpegSize(night4k)).toEqual({ width: 4096, height: 2048 });
  });

  it("ships topography and ocean maps copied into the site, not loaded from a CDN", () => {
    for (const path of ["public/textures/earth-topology.png", "public/textures/earth-water.png"]) {
      const bytes = readFileSync(path);
      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(bytes.byteLength).toBeGreaterThan(1000);
    }
    expect(globeSource).toContain("bumpMap");
    expect(globeSource).toContain("specularMap");
    expect(globeSource).toContain("EARTH_BUMP_SCALE");
    expect(EARTH_BUMP_SCALE).toBeGreaterThan(0);
  });
});

describe("progressive earth photo requests", () => {
  it("requests only the 2K day and night photos on the first screen", () => {
    const startup = startupTextures();
    expect(startup.filter((item) => item.kind === "color").map((item) => item.path)).toEqual([
      "textures/earth-day.jpg",
      "textures/earth-night.jpg",
    ]);
    expect(startup.map((item) => item.path).join(" ")).not.toMatch(/-[48]k\.jpg/);
    expect(globeSource).toContain("startupTextures()");
    expect(globeSource).not.toContain("earth-day-8k");
    expect(globeSource).not.toContain("earth-night-8k");
    expect(globeSource).not.toContain("earth-day-4k");
    expect(globeSource).not.toContain("earth-night-4k");

    const schedule = new EarthTextureSchedule();
    const desktop = { narrow: false, maxTextureSize: 8192, altitude: 2.5 };
    expect(schedule.noteViewChange(desktop)).toEqual([]);
  });

  it("loads 8K on a desktop only after both 2K photos are ready, and caps to the GPU", () => {
    const desktop = { narrow: false, maxTextureSize: 8192, altitude: 2.5 };
    const schedule = new EarthTextureSchedule();
    expect(schedule.noteStartupPhoto("day", desktop)).toEqual([]);
    expect(schedule.noteStartupPhoto("night", desktop)).toEqual([
      { role: "day", path: "textures/earth-day-8k.jpg", edge: 8192 },
      { role: "night", path: "textures/earth-night-8k.jpg", edge: 8192 },
    ]);
    expect(schedule.noteViewChange(desktop)).toEqual([]);

    const capped = new EarthTextureSchedule();
    const gpu4k = { narrow: false, maxTextureSize: 4096, altitude: 2.5 };
    capped.noteStartupPhoto("day", gpu4k);
    expect(capped.noteStartupPhoto("night", gpu4k).map((item) => item.path)).toEqual([
      "textures/earth-day-4k.jpg",
      "textures/earth-night-4k.jpg",
    ]);

    const tiny = new EarthTextureSchedule();
    const gpu2k = { narrow: false, maxTextureSize: 2048, altitude: 0.4 };
    tiny.noteStartupPhoto("night", gpu2k);
    expect(tiny.noteStartupPhoto("day", gpu2k)).toEqual([]);
    expect(photoEdgeFor(8192, 8191)).toBe(4096);
    expect(photoEdgeFor(8192, Number.NaN)).toBe(2048);
  });

  it("waits for a pinch zoom on a phone before requesting 4K", () => {
    const far = { narrow: true, maxTextureSize: 8192, altitude: 2.5 };
    const schedule = new EarthTextureSchedule();
    schedule.noteStartupPhoto("day", far);
    expect(schedule.noteStartupPhoto("night", far)).toEqual([]);
    expect(schedule.noteViewChange({ ...far, altitude: ZOOM_IN_ALTITUDE + 0.01 })).toEqual([]);
    expect(schedule.noteViewChange({ ...far, altitude: ZOOM_IN_ALTITUDE })).toEqual([
      { role: "day", path: "textures/earth-day-4k.jpg", edge: 4096 },
      { role: "night", path: "textures/earth-night-4k.jpg", edge: 4096 },
    ]);
  });

  it("uses the device's maximum anisotropy", () => {
    expect(anisotropyLevel(16)).toBe(16);
    expect(anisotropyLevel(0)).toBe(1);
    expect(anisotropyLevel(Number.NaN)).toBe(1);
    expect(globeSource).toContain("getMaxAnisotropy");
    expect(globeSource).toContain("anisotropyLevel");
  });
});
