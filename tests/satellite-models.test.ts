import { describe, expect, it } from "vitest";
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3, type Object3D } from "three";
import globeSource from "../src/globe-view.ts?raw";
import { SatelliteModels } from "../src/satellite-mesh";
import {
  GENERIC_SCREEN_PX,
  ISS_SCREEN_PX,
  MODEL_COLOR,
  SHADOW_SHADE,
  SOLAR_GRID_CELLS,
  SOLAR_PANEL_NAVY,
  cross,
  dot,
  genericSatelliteSpec,
  issModelSpec,
  isInEarthShadow,
  normalize,
  paintSolarPanelGrid,
  panelNormal,
  satelliteFrame,
  screenConstantScale,
  shadeHex,
  type SolarGridPainter,
  type Vec3,
} from "../src/satellite-shape";
import type { SatellitePoint } from "../src/satellites";

function unit(value: Vec3): Vec3 {
  return normalize(value);
}

function alignment(a: Vec3, b: Vec3): number {
  const left = unit(a);
  const right = unit(b);
  return dot(left, right);
}

describe("satellite model parts", () => {
  it("builds an ISS with a long truss, eight grid wings, cylinders, and white radiators", () => {
    const iss = issModelSpec();
    const panels = iss.parts.filter((part) => part.role === "solar-panel");
    const modules = iss.parts.filter((part) => part.role === "module");
    const radiators = iss.parts.filter((part) => part.role === "radiator");
    const truss = iss.parts.find((part) => part.role === "truss");

    expect(truss).toBeTruthy();
    expect(panels).toHaveLength(8);
    expect(panels.filter((part) => part.center.x > 0)).toHaveLength(4);
    expect(panels.filter((part) => part.center.x < 0)).toHaveLength(4);
    expect(panels.filter((part) => part.center.y > 0)).toHaveLength(4);
    expect(panels.filter((part) => part.center.y < 0)).toHaveLength(4);
    expect(modules.length).toBeGreaterThanOrEqual(4);
    expect(radiators).toHaveLength(2);

    if (!truss) {
      return;
    }
    expect(truss.size.x).toBeGreaterThan(truss.size.y * 10);
    expect(truss.size.x).toBeGreaterThan(truss.size.z * 10);
    expect(iss.span).toBeGreaterThanOrEqual(truss.size.x);

    for (const panel of panels) {
      expect(panel.size.y / panel.size.x).toBeGreaterThanOrEqual(2);
      expect(panel.size.z).toBeLessThan(panel.size.x);
      expect(panel.size.z).toBeLessThan(panel.size.y);
      expect(panel.size.y).toBeLessThan(truss.size.x);
    }
    for (const modulePart of modules) {
      expect(modulePart.size.z).toBeGreaterThan(modulePart.size.x);
      expect(modulePart.size.x).toBeCloseTo(modulePart.size.y, 5);
    }
    for (const radiator of radiators) {
      expect(radiator.size.x).toBeGreaterThan(radiator.size.y * 4);
      expect(radiator.size.z).toBeGreaterThan(radiator.size.y * 4);
    }
  });

  it("builds other satellites as a gold box with two wings", () => {
    const generic = genericSatelliteSpec();
    const body = generic.parts.find((part) => part.role === "body");
    const wings = generic.parts.filter((part) => part.role === "solar-panel");

    expect(generic.parts.filter((part) => part.role === "body")).toHaveLength(1);
    expect(wings).toHaveLength(2);
    expect(body).toBeTruthy();
    if (!body || !wings[0] || !wings[1]) {
      return;
    }
    expect(wings[0].center.x * wings[1].center.x).toBeLessThan(0);
    expect(wings[0].size.x).toBeGreaterThan(body.size.x * 2);
    expect(wings[0].size.z).toBeLessThan(wings[0].size.x);
    expect(wings[0].size.x).toBe(wings[1].size.x);
    expect(generic.span).toBeGreaterThan(body.size.z);
  });
});

describe("solar panel grid", () => {
  it("fills a navy cell grid on a canvas painter", () => {
    const events: string[] = [];
    const painter: SolarGridPainter = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      fillRect() {
        events.push(`fill:${this.fillStyle}`);
      },
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {
        events.push(`stroke:${this.strokeStyle}`);
      },
    };

    paintSolarPanelGrid(painter, 64);
    expect(events[0]).toBe(`fill:${SOLAR_PANEL_NAVY}`);
    expect(events.filter((event) => event.startsWith("stroke:"))).toHaveLength((SOLAR_GRID_CELLS - 1) * 2);
    expect(painter.strokeStyle).toBe("#A9C0E4");
    expect(painter.lineWidth).toBeGreaterThanOrEqual(2);
  });
});

describe("satellite orientation", () => {
  it("keeps the nose on the velocity vector and the panel face on the sun", () => {
    const velocity = { x: 4, y: -1, z: 0.5 };
    const sun = { x: 1, y: 2, z: 0.4 };
    const frame = satelliteFrame(velocity, sun);

    expect(alignment(frame.z, velocity)).toBeCloseTo(1, 6);
    expect(alignment(panelNormal(frame), sun)).toBeCloseTo(1, 6);
    expect(Math.abs(dot(frame.x, frame.y))).toBeLessThan(1e-8);
    expect(Math.abs(dot(frame.y, frame.z))).toBeLessThan(1e-8);
    expect(Math.abs(dot(frame.z, frame.x))).toBeLessThan(1e-8);
    expect(alignment(cross(frame.x, frame.y), frame.z)).toBeCloseTo(1, 6);
  });

  it("still faces the sun when it sits straight ahead or straight behind", () => {
    const ahead = satelliteFrame({ x: 0, y: 0, z: 7 }, { x: 0, y: 0, z: 3 });
    expect(alignment(ahead.z, { x: 0, y: 0, z: 1 })).toBeCloseTo(1, 6);
    expect(alignment(panelNormal(ahead), { x: 0, y: 0, z: 1 })).toBeCloseTo(1, 6);

    const behind = satelliteFrame({ x: 2, y: 0, z: 0 }, { x: -5, y: 0, z: 0 });
    expect(alignment(behind.z, { x: 1, y: 0, z: 0 })).toBeCloseTo(1, 6);
    expect(alignment(panelNormal(behind), { x: -1, y: 0, z: 0 })).toBeCloseTo(1, 6);
  });
});

describe("earth shadow and screen size", () => {
  it("darkens only the night-side cylinder of the earth", () => {
    const sun = { x: 0, y: 0, z: 1 };
    expect(isInEarthShadow({ x: 0, y: 0, z: -1.06 }, sun)).toBe(true);
    expect(isInEarthShadow({ x: 0, y: 0, z: 1.06 }, sun)).toBe(false);
    expect(isInEarthShadow({ x: 0, y: 1.4, z: -0.3 }, sun)).toBe(false);
    expect(shadeHex(0x1a2f6b, SHADOW_SHADE)).toBeLessThan(0x1a2f6b);
    expect(shadeHex(MODEL_COLOR.panel, 1)).toBe(MODEL_COLOR.panel);
  });

  it("grows the model in proportion to camera distance so the pixel size stays put", () => {
    const near = screenConstantScale(200, 340, 50, 109, ISS_SCREEN_PX);
    const far = screenConstantScale(400, 340, 50, 109, ISS_SCREEN_PX);
    expect(far / near).toBeCloseTo(2, 6);
    expect(screenConstantScale(200, 680, 50, 109, ISS_SCREEN_PX) / near).toBeCloseTo(0.5, 6);
    expect(screenConstantScale(0, 340, 50, 109, ISS_SCREEN_PX)).toBe(0);
    expect(GENERIC_SCREEN_PX).toBeLessThan(ISS_SCREEN_PX);
  });
});

function point(partial: Partial<SatellitePoint> & Pick<SatellitePoint, "lat" | "lng" | "iss" | "velocity">): SatellitePoint {
  return {
    alt: 0.06,
    color: partial.iss ? "#F5B544" : "#6CC4FF",
    ...partial,
  };
}

function byRole(root: Object3D, role: string): Object3D[] {
  const found: Object3D[] = [];
  root.traverse((child) => {
    if (child.userData.role === role) {
      found.push(child);
    }
  });
  return found;
}

describe("satellite meshes", () => {
  it("places the ISS nose on the velocity and the wing normal on the sun", () => {
    const models = new SatelliteModels(1);
    const sun = { x: 0.2, y: 0.9, z: 0.35 };
    const velocity = { x: 0.02, y: 0, z: 0 };
    models.sync(
      [
        point({ lat: 0, lng: 0, iss: true, velocity }),
        point({ lat: 12, lng: 40, iss: false, velocity: { x: 0, y: 0.01, z: 0.01 } }),
      ],
      {
        globeRadius: 100,
        cameraPosition: { x: 0, y: 0, z: 350 },
        viewportHeight: 340,
        fovDegrees: 50,
        sun,
      },
    );

    expect(byRole(models.object, "solar-panel").filter((child) => child.parent?.name === "panel-pivot" || child.parent?.parent?.name === "iss")).toHaveLength(8);
    expect(byRole(models.object, "truss")).toHaveLength(1);
    expect(byRole(models.object, "module").length).toBeGreaterThanOrEqual(4);
    expect(byRole(models.object, "radiator")).toHaveLength(2);
    expect(byRole(models.object, "panel-pivot")).toHaveLength(4);

    const iss = models.object.children.find((child) => child.name === "iss");
    expect(iss).toBeTruthy();
    if (!iss) {
      return;
    }
    iss.updateWorldMatrix(true, true);
    const nose = new Vector3(0, 0, 1).applyQuaternion(iss.getWorldQuaternion(new Quaternion()));
    expect(nose.x).toBeCloseTo(1, 4);
    expect(nose.y).toBeCloseTo(0, 4);
    expect(nose.z).toBeCloseTo(0, 4);

    const panel = byRole(iss, "solar-panel")[0];
    expect(panel).toBeTruthy();
    if (!panel) {
      return;
    }
    panel.updateWorldMatrix(true, false);
    const normal = new Vector3(0, 0, 1).applyQuaternion(panel.getWorldQuaternion(new Quaternion()));
    const sunUnit = unit(sun);
    expect(normal.x * sunUnit.x + normal.y * sunUnit.y + normal.z * sunUnit.z).toBeCloseTo(1, 4);

    const distance = 350 - 100 * 1.06;
    const expectedScale = screenConstantScale(distance, 340, 50, issModelSpec().span, ISS_SCREEN_PX);
    expect(iss.scale.x).toBeCloseTo(expectedScale, 4);
    expect(iss.scale.y).toBe(iss.scale.x);
    expect(iss.scale.z).toBe(iss.scale.x);
    models.dispose();
  });

  it("instances the other satellites and darkens a model inside Earth's shadow", () => {
    const models = new SatelliteModels(1);
    const sun = { x: 0, y: 0, z: 1 };
    models.sync(
      [
        point({ lat: 0, lng: 180, iss: true, velocity: { x: 0.01, y: 0, z: 0 } }),
        point({ lat: 0, lng: 0, iss: false, velocity: { x: 0, y: 1, z: 0 } }),
      ],
      {
        globeRadius: 100,
        cameraPosition: { x: 0, y: 0, z: 350 },
        viewportHeight: 340,
        fovDegrees: 50,
        sun,
      },
    );

    const truss = byRole(models.object, "truss")[0] as { material?: { color: { getHex(): number } } };
    expect(truss.material?.color.getHex()).toBe(shadeHex(MODEL_COLOR.truss, SHADOW_SHADE));

    const body = models.object.children.find((child) => child.name === "generic-body");
    const wings = models.object.children.find((child) => child.name === "generic-panel");
    expect(body).toBeInstanceOf(InstancedMesh);
    expect(wings).toBeInstanceOf(InstancedMesh);
    if (!(body instanceof InstancedMesh) || !(wings instanceof InstancedMesh)) {
      return;
    }
    expect(body.count).toBe(1);
    expect(wings.count).toBe(2);

    const matrix = new Matrix4();
    body.getMatrixAt(0, matrix);
    const axisLength = Math.hypot(matrix.elements[8] ?? 0, matrix.elements[9] ?? 0, matrix.elements[10] ?? 0);
    expect((matrix.elements[9] ?? 0) / axisLength).toBeCloseTo(1, 4);

    const color = new Color();
    body.getColorAt(0, color);
    expect(color.r).toBeCloseTo(1, 5);

    models.sync(
      [point({ lat: 0, lng: 180, iss: false, velocity: { x: 0.01, y: 0, z: 0 } })],
      {
        globeRadius: 100,
        cameraPosition: { x: 0, y: 0, z: 350 },
        viewportHeight: 340,
        fovDegrees: 50,
        sun,
      },
    );
    body.getColorAt(0, color);
    const shadowed = new Color().setRGB(SHADOW_SHADE, SHADOW_SHADE, SHADOW_SHADE);
    expect(color.r).toBeCloseTo(shadowed.r, 5);
    expect(color.r).toBeLessThan(0.5);
    models.dispose();
  });
});

describe("many satellites", () => {
  it("keeps the other satellites on two instanced meshes", () => {
    const models = new SatelliteModels(1);
    const points = Array.from({ length: 80 }, (_, index) =>
      point({
        lat: (index % 20) * 4 - 40,
        lng: (index * 9) % 360 - 180,
        iss: index === 0,
        velocity: { x: 0.01, y: 0, z: 0.01 },
      }),
    );
    models.sync(points, {
      globeRadius: 100,
      cameraPosition: { x: 0, y: 0, z: 350 },
      viewportHeight: 340,
      fovDegrees: 50,
      sun: { x: 0, y: 1, z: 0 },
    });

    const bodies = models.object.children.filter((child) => child.name === "generic-body");
    const panels = models.object.children.filter((child) => child.name === "generic-panel");
    expect(bodies).toHaveLength(1);
    expect(panels).toHaveLength(1);
    expect(bodies[0]).toBeInstanceOf(InstancedMesh);
    expect(panels[0]).toBeInstanceOf(InstancedMesh);
    if (bodies[0] instanceof InstancedMesh && panels[0] instanceof InstancedMesh) {
      expect(bodies[0].count).toBe(79);
      expect(panels[0].count).toBe(158);
    }
    const separate = byRole(models.object, "truss").length + byRole(models.object, "module").length;
    expect(separate).toBeLessThan(20);
    models.dispose();
  });
});

describe("globe marker replacement", () => {
  it("draws code-built models instead of HTML dots", () => {
    expect(globeSource).toContain("new SatelliteModels");
    expect(globeSource).not.toContain("htmlElementsData");
    expect(globeSource).not.toContain("globe-sat");
  });
});
