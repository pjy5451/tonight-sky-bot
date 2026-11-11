import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ShaderLib } from "three";
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
    expect(patched).toContain("uniform vec3 uSunDirection");
    expect(patched).toContain("smoothstep(-0.12, 0.28, sunDot)");
    expect(patched).toContain("mix(totalEmissiveRadiance, diffuseColor.rgb, dayFactor)");
    expect(patched).not.toContain(PHONG_OUTGOING_LIGHT);
  });
});
