import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BufferAttribute, PerspectiveCamera, ShaderMaterial } from "three";
import { constants } from "satellite.js";
import { defaultGlobeFilter, toggleFilterGroup, toggleKoreaOnly } from "../src/catalog";
import { patchDayNightFragmentShader } from "../src/globe-view";
import {
  CITY_LIGHT_COLOR,
  EARTH_SHORT_SIDE_FRACTION,
  FILTER_HIGHLIGHT_COLOR,
  ISS_DOT_COLOR,
  ISS_DOT_DIAMETER_PX,
  ISS_ORBIT_OPACITY,
  ISS_ORBIT_WIDTH_PX,
  NIGHT_VEIL_COLOR,
  NIGHT_VEIL_MAX,
  NIGHT_VEIL_MIN,
  SAT_DIM_OPACITY,
  SAT_DOT_COLOR,
  SAT_DOT_DIAMETER_MAX_PX,
  SAT_DOT_DIAMETER_PX,
  SAT_DOT_OPACITY_MAX,
  SAT_DOT_OPACITY_MIN,
  SELECTED_ORBIT_WIDTH_PX,
  STAR_DIAMETER_MAX_PX,
  STAR_DIAMETER_MIN_PX,
  STAR_OPACITY_MAX,
  STAR_OPACITY_MIN,
  earthBlocksSatellite,
  earthFrameAltitude,
  earthHeightFraction,
  exclusiveHighlight,
  geoFitAltitude,
  satellitePaint,
  starSamples,
} from "../src/globe-style";
import { SatelliteField } from "../src/satellite-field";
import { GLOBE_SCENE_RADIUS } from "../src/satellite-shape";
import type { SatellitePoint } from "../src/satellites";

describe("globe dot constants", () => {
  it("keeps ordinary dots at 1–2px, never past 3px, in the pale range", () => {
    expect(SAT_DOT_DIAMETER_PX).toBeGreaterThanOrEqual(1);
    expect(SAT_DOT_DIAMETER_PX).toBeLessThanOrEqual(2);
    expect(SAT_DOT_DIAMETER_MAX_PX).toBeLessThanOrEqual(3);
    expect(SAT_DOT_DIAMETER_PX).toBeLessThanOrEqual(SAT_DOT_DIAMETER_MAX_PX);
    expect(SAT_DOT_COLOR).toBe("#DDE6F5");
    expect(SAT_DOT_OPACITY_MIN).toBeGreaterThanOrEqual(0.35);
    expect(SAT_DOT_OPACITY_MAX).toBeLessThanOrEqual(0.9);
    expect(SAT_DIM_OPACITY).toBe(0.15);
    expect(ISS_DOT_COLOR).toBe("#E8B04A");
    expect(ISS_DOT_DIAMETER_PX).toBe(4);
    expect(ISS_ORBIT_WIDTH_PX).toBe(1);
    expect(ISS_ORBIT_OPACITY).toBe(0.6);
    expect(SELECTED_ORBIT_WIDTH_PX).toBe(1);
    expect(FILTER_HIGHLIGHT_COLOR).toEqual({
      korea: "#FF7A59",
      starlink: "#A9B8D6",
      nav: "#7BD88F",
      geo: "#C59BFF",
    });
    expect(NIGHT_VEIL_COLOR).toBe("#03050A");
    expect(NIGHT_VEIL_MIN).toBeGreaterThanOrEqual(0.86);
    expect(NIGHT_VEIL_MAX).toBeLessThanOrEqual(0.94);
    expect(CITY_LIGHT_COLOR).toBe("#FFD58A");
  });

  it("paints the all-view as one pale color and a single group in its own color", () => {
    const pale = satellitePaint({ noradId: 12, iss: false, group: "starlink" }, null);
    expect(pale.color).toBe(SAT_DOT_COLOR);
    expect(pale.diameterPx).toBeLessThanOrEqual(SAT_DOT_DIAMETER_MAX_PX);
    expect(pale.opacity).toBeGreaterThanOrEqual(SAT_DOT_OPACITY_MIN);
    expect(pale.opacity).toBeLessThanOrEqual(SAT_DOT_OPACITY_MAX);
    expect(pale.glow).toBe(false);

    const iss = satellitePaint({ noradId: 25544, iss: true, group: "stations" }, null);
    expect(iss.color).toBe(ISS_DOT_COLOR);
    expect(iss.diameterPx).toBe(ISS_DOT_DIAMETER_PX);
    expect(iss.glow).toBe(true);

    const starlink = satellitePaint({ noradId: 9, group: "starlink" }, "starlink");
    const other = satellitePaint({ noradId: 10, group: "geo" }, "starlink");
    expect(starlink.color).toBe("#A9B8D6");
    expect(starlink.opacity).toBe(SAT_DOT_OPACITY_MAX);
    expect(other.opacity).toBe(SAT_DIM_OPACITY);
    expect(other.color).toBe(SAT_DOT_COLOR);

    const korea = satellitePaint({ noradId: 3, korean: true, group: "geo" }, "korea");
    expect(korea.color).toBe("#FF7A59");
    const dimmedIss = satellitePaint({ noradId: 25544, iss: true, group: "stations" }, "starlink");
    expect(dimmedIss.glow).toBe(false);
    expect(dimmedIss.opacity).toBe(SAT_DIM_OPACITY);
  });

  it("treats Korea-only and a lone category as the highlight, and the full set as none", () => {
    expect(exclusiveHighlight(defaultGlobeFilter())).toBeNull();
    expect(exclusiveHighlight(toggleKoreaOnly(defaultGlobeFilter()))).toBe("korea");
    let filter = defaultGlobeFilter();
    for (const group of ["stations", "gps-ops", "galileo", "geo", "weather", "science", "korea"] as const) {
      filter = toggleFilterGroup(filter, group);
    }
    expect(exclusiveHighlight(filter)).toBe("starlink");
    filter = toggleFilterGroup(defaultGlobeFilter(), "starlink");
    for (const group of ["stations", "geo", "weather", "science", "korea"] as const) {
      filter = toggleFilterGroup(filter, group);
    }
    expect(exclusiveHighlight(filter)).toBe("nav");
  });
});

describe("earth occlusion and camera", () => {
  const camera = { x: 0, y: 0, z: 3.5 };

  it("hides satellites behind the earth and keeps the ones in front", () => {
    expect(earthBlocksSatellite({ x: 0, y: 0, z: -1.2 }, camera)).toBe(true);
    expect(earthBlocksSatellite({ x: 0, y: 0, z: 1.2 }, camera)).toBe(false);
    expect(earthBlocksSatellite({ x: 2.2, y: 0, z: 0 }, camera)).toBe(false);
  });

  it("frames the earth at about 60% of the short side and still reaches GEO", () => {
    const altitude = earthFrameAltitude(50, 1.4);
    expect(earthHeightFraction(altitude, 50)).toBeCloseTo(EARTH_SHORT_SIDE_FRACTION, 2);
    const portrait = earthFrameAltitude(50, 0.5);
    expect(portrait).toBeGreaterThan(altitude);
    const fit = geoFitAltitude(50, constants.earthRadius);
    expect(fit).toBeGreaterThan(altitude);
    expect(fit).toBeLessThan(40);
  });

  it("darkens the night side with the veil and gold city lights", () => {
    const shader = patchDayNightFragmentShader("void main() {\n#include <common>\n" + "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;\n}");
    expect(shader).toContain("mix(totalEmissiveRadiance, dayColor, dayFactor)");
    expect(shader).toContain(NIGHT_VEIL_MIN.toFixed(2));
    expect(shader).toContain(NIGHT_VEIL_MAX.toFixed(2));
    expect(shader).toContain("nightCover");
  });
});

describe("star field", () => {
  it("keeps background stars between 0.5px and 1.2px", () => {
    const stars = starSamples(40);
    expect(stars).toHaveLength(40);
    for (const star of stars) {
      expect(star.sizePx).toBeGreaterThanOrEqual(STAR_DIAMETER_MIN_PX);
      expect(star.sizePx).toBeLessThanOrEqual(STAR_DIAMETER_MAX_PX);
      expect(star.opacity).toBeGreaterThanOrEqual(STAR_OPACITY_MIN);
      expect(star.opacity).toBeLessThanOrEqual(STAR_OPACITY_MAX);
      expect(Math.hypot(star.x, star.y, star.z)).toBeCloseTo(1, 5);
    }
    expect(starSamples(4)).toEqual(starSamples(4));
  });
});

function dot(partial: Partial<SatellitePoint> & Pick<SatellitePoint, "lat" | "lng">): SatellitePoint {
  return {
    alt: 0.05,
    color: "#DDE6F5",
    iss: false,
    velocity: { x: 0, y: 0, z: 0 },
    marker: "dot",
    ...partial,
  };
}

describe("satellite point field", () => {
  it("draws ten thousand satellites in one Points object and hides the far side", () => {
    const field = new SatelliteField();
    const points = Array.from({ length: 10_000 }, (_, index) =>
      dot({
        lat: (index % 180) - 90,
        lng: (index * 3) % 360 - 180,
        noradId: index + 1,
        group: "starlink",
      }),
    );
    points.push(dot({ lat: 0, lng: 0, iss: true, marker: "model", noradId: 25544 }));
    const camera = { x: 0, y: 0, z: GLOBE_SCENE_RADIUS * 3.5 };
    field.sync(points, { cameraPosition: camera, pixelRatio: 1, highlight: null });
    expect(field.drawCallCount()).toBe(1);
    expect(field.points.name).toBe("satellite-field");
    expect(field.points.type).toBe("Points");
    const material = field.points.material as ShaderMaterial;
    expect(material.depthTest).toBe(true);
    expect(material.fragmentShader).toContain("discard");

    const hide = field.points.geometry.getAttribute("aHide") as BufferAttribute;
    let hidden = 0;
    let shown = 0;
    for (let index = 0; index < points.length; index += 1) {
      if (hide.getX(index) > 0.5) {
        hidden += 1;
        expect(field.isHidden(index)).toBe(true);
      } else {
        shown += 1;
      }
    }
    expect(hidden).toBeGreaterThan(1000);
    expect(shown).toBeGreaterThan(1000);

    const size = field.points.geometry.getAttribute("aSize") as BufferAttribute;
    const issSize = size.getX(points.length - 1);
    expect(issSize).toBeGreaterThan(ISS_DOT_DIAMETER_PX);
    for (let index = 0; index < 20; index += 1) {
      expect(size.getX(index)).toBeLessThanOrEqual(SAT_DOT_DIAMETER_MAX_PX);
    }
    field.dispose();
  });

  it("picks the dot under the pointer and skips one behind the earth", () => {
    const field = new SatelliteField();
    const front = dot({ lat: 0, lng: 0, noradId: 1, name: "front" });
    const back = dot({ lat: 0, lng: 180, noradId: 2, name: "back" });
    const camera = new PerspectiveCamera(50, 1, 0.1, 5000);
    camera.position.set(0, 0, GLOBE_SCENE_RADIUS * 3.5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    field.sync([front, back], {
      cameraPosition: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      pixelRatio: 1,
      highlight: null,
    });
    expect(field.isHidden(0)).toBe(false);
    expect(field.isHidden(1)).toBe(true);
    const hit = field.nearest(camera, 170, 170, 340, 340);
    expect(hit?.point.name).toBe("front");
    expect(field.nearest(camera, 0, 0, 340, 340)).toBeNull();
    field.dispose();
  });
});

describe("default globe capture", () => {
  it("stores the Playwright capture of the default globe view", () => {
    const bytes = readFileSync("tests/screenshots/globe-default.png");
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.byteLength).toBeGreaterThan(3000);
  });
});
