import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  Quaternion,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import type { SatellitePoint } from "./satellites";
import {
  DOT_SCREEN_PX,
  DOT_SPAN,
  GENERIC_SCREEN_PX,
  ISS_SCREEN_PX,
  MODEL_COLOR,
  SHADOW_SHADE,
  genericSatelliteSpec,
  globeVector,
  isInEarthShadow,
  issModelSpec,
  lengthOf,
  paintSolarPanelGrid,
  satelliteFrame,
  screenConstantScale,
  shadeHex,
  travelDirection,
  type ModelPart,
  type ModelView,
  type SatelliteFrame,
  type Vec3,
} from "./satellite-shape";

const PANEL_TEXTURE_SIZE = 64;
const INITIAL_CAPACITY = 128;
const DOT_CAPACITY = 256;

export type ModelRay = {
  intersectObject(object: Object3D, recursive?: boolean): Array<{ object: Object3D; instanceId?: number }>;
};

type DotRig = {
  mesh: InstancedMesh;
  geometry: BufferGeometry;
  material: Material;
  capacity: number;
};

type ShadedMaterial = {
  material: MeshPhongMaterial;
  baseHex: number;
};

function phong(hex: number, options: { shininess?: number; doubleSide?: boolean } = {}): MeshPhongMaterial {
  const material = new MeshPhongMaterial();
  material.color.setHex(hex);
  material.shininess = options.shininess ?? 14;
  if (options.doubleSide) {
    material.side = DoubleSide;
  }
  return material;
}

function track(material: MeshPhongMaterial, baseHex: number, shaded: ShadedMaterial[]): MeshPhongMaterial {
  shaded.push({ material, baseHex });
  return material;
}

/** 칸 무늬 텍스처. 캔버스가 없으면 null이고, 그때는 단색 남색을 쓴다. */
export function createSolarPanelTexture(anisotropy: number): CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = PANEL_TEXTURE_SIZE;
  canvas.height = PANEL_TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  paintSolarPanelGrid(context, PANEL_TEXTURE_SIZE);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = Math.max(1, anisotropy);
  texture.needsUpdate = true;
  return texture;
}

function tag(mesh: Object3D, role: string, baseHex: number): void {
  mesh.name = role;
  mesh.userData.role = role;
  mesh.userData.baseHex = baseHex;
}

function applyShade(shaded: readonly ShadedMaterial[], factor: number): void {
  for (const slot of shaded) {
    slot.material.color.setHex(shadeHex(slot.baseHex, factor));
  }
}

type IssRig = {
  group: Group;
  pivots: Object3D[];
  shaded: ShadedMaterial[];
  span: number;
};

function createIssRig(panelMap: Texture | null): IssRig {
  const spec = issModelSpec();
  const group = new Group();
  group.name = "iss";
  const shaded: ShadedMaterial[] = [];
  const panelHex = panelMap ? 0xffffff : MODEL_COLOR.panel;
  const panelMaterial = track(phong(panelHex, { doubleSide: true, shininess: 8 }), panelHex, shaded);
  panelMaterial.map = panelMap;

  const trussMaterial = track(phong(MODEL_COLOR.truss, { shininess: 20 }), MODEL_COLOR.truss, shaded);
  const moduleMaterial = track(phong(MODEL_COLOR.module, { shininess: 18 }), MODEL_COLOR.module, shaded);
  const radiatorMaterial = track(phong(MODEL_COLOR.radiator, { shininess: 6 }), MODEL_COLOR.radiator, shaded);

  const pivots = new Map<number, Group>();
  for (const part of spec.parts) {
    if (part.role === "solar-panel") {
      const key = Math.round(part.center.x * 10);
      let pivot = pivots.get(key);
      if (!pivot) {
        pivot = new Group();
        pivot.name = "panel-pivot";
        pivot.userData.role = "panel-pivot";
        pivot.position.set(part.center.x, 0, 0);
        group.add(pivot);
        pivots.set(key, pivot);
      }
      const mesh = new Mesh(new BoxGeometry(part.size.x, part.size.y, part.size.z), panelMaterial);
      tag(mesh, "solar-panel", panelHex);
      mesh.position.set(0, part.center.y, part.center.z);
      pivot.add(mesh);
      continue;
    }

    const mesh = meshForPart(part, {
      truss: trussMaterial,
      module: moduleMaterial,
      radiator: radiatorMaterial,
    });
    if (mesh) {
      tag(mesh, part.role, roleHex(part.role));
      group.add(mesh);
    }
  }

  return { group, pivots: [...pivots.values()], shaded, span: spec.span };
}

function roleHex(role: ModelPart["role"]): number {
  if (role === "truss") {
    return MODEL_COLOR.truss;
  }
  if (role === "module") {
    return MODEL_COLOR.module;
  }
  if (role === "radiator") {
    return MODEL_COLOR.radiator;
  }
  if (role === "body") {
    return MODEL_COLOR.body;
  }
  return MODEL_COLOR.panel;
}

function meshForPart(
  part: ModelPart,
  materials: { truss: MeshPhongMaterial; module: MeshPhongMaterial; radiator: MeshPhongMaterial },
): Mesh | null {
  if (part.role === "truss") {
    const mesh = new Mesh(new BoxGeometry(part.size.x, part.size.y, part.size.z), materials.truss);
    mesh.position.set(part.center.x, part.center.y, part.center.z);
    return mesh;
  }
  if (part.role === "radiator") {
    const mesh = new Mesh(new BoxGeometry(part.size.x, part.size.y, part.size.z), materials.radiator);
    mesh.position.set(part.center.x, part.center.y, part.center.z);
    return mesh;
  }
  if (part.role === "module") {
    const mesh = new Mesh(
      new CylinderGeometry(part.size.x / 2, part.size.y / 2, part.size.z, 10),
      materials.module,
    );
    mesh.position.set(part.center.x, part.center.y, part.center.z);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  }
  return null;
}

type GenericRig = {
  bodyMesh: InstancedMesh;
  panelMesh: InstancedMesh;
  geometry: BufferGeometry[];
  materials: Material[];
  capacity: number;
  span: number;
  panelCenters: Vec3[];
};

function createGenericRig(panelMap: Texture | null, capacity: number): GenericRig {
  const spec = genericSatelliteSpec();
  const body = spec.parts.find((part) => part.role === "body");
  const panels = spec.parts.filter((part) => part.role === "solar-panel");
  const bodySize = body?.size ?? { x: 1, y: 1, z: 1 };
  const panelSize = panels[0]?.size ?? { x: 1, y: 1, z: 0.1 };

  const bodyGeometry = new BoxGeometry(bodySize.x, bodySize.y, bodySize.z);
  const panelGeometry = new BoxGeometry(panelSize.x, panelSize.y, panelSize.z);
  const bodyMaterial = phong(MODEL_COLOR.body, { shininess: 32 });
  bodyMaterial.specular.setHex(MODEL_COLOR.bodySpecular);
  const panelHex = panelMap ? 0xffffff : MODEL_COLOR.panel;
  const panelMaterial = phong(panelHex, { doubleSide: true, shininess: 8 });
  panelMaterial.map = panelMap;

  const bodyMesh = new InstancedMesh(bodyGeometry, bodyMaterial, capacity);
  const panelMesh = new InstancedMesh(panelGeometry, panelMaterial, capacity * panels.length);
  bodyMesh.name = "generic-body";
  panelMesh.name = "generic-panel";
  bodyMesh.userData.role = "body";
  panelMesh.userData.role = "solar-panel";
  bodyMesh.count = 0;
  panelMesh.count = 0;
  bodyMesh.visible = false;
  panelMesh.visible = false;
  bodyMesh.frustumCulled = false;
  panelMesh.frustumCulled = false;

  return {
    bodyMesh,
    panelMesh,
    geometry: [bodyGeometry, panelGeometry],
    materials: [bodyMaterial, panelMaterial],
    capacity,
    span: spec.span,
    panelCenters: panels.map((part) => part.center),
  };
}

function createDotRig(capacity: number): DotRig {
  const geometry = new SphereGeometry(DOT_SPAN / 2, 6, 5);
  const material = new MeshBasicMaterial({ color: 0xffffff });
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.name = "catalog-dots";
  mesh.userData.role = "dot";
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false;
  return { mesh, geometry, material, capacity };
}

function cssColor(hex: string, target: Color): void {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  target.setHex(match ? Number.parseInt(match[1] ?? "6CC4FF", 16) : 0x6cc4ff);
}

/**
 * ISS는 부품을 공유하는 하나의 그룹, 톈궁·허블은 몸체·날개 인스턴스,
 * 나머지 수천 개는 종류별 색의 점 인스턴스 한 묶음이다.
 */
export class SatelliteModels {
  readonly object: Group;
  private readonly iss: IssRig;
  private generic: GenericRig;
  private dots: DotRig;
  private issPoint: SatellitePoint | null = null;
  private craftPoints: SatellitePoint[] = [];
  private dotPoints: SatellitePoint[] = [];
  private readonly panelTexture: Texture | null;
  private readonly dotColor = new Color();
  private readonly axisX = new Vector3();
  private readonly axisY = new Vector3();
  private readonly axisZ = new Vector3();
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly basis = new Matrix4();
  private readonly modelMatrix = new Matrix4();
  private readonly localMatrix = new Matrix4();
  private readonly spin = new Matrix4();
  private readonly shift = new Matrix4();
  private readonly instanceMatrix = new Matrix4();
  private readonly shadeColor = new Color();

  constructor(anisotropy: number) {
    this.panelTexture = createSolarPanelTexture(anisotropy);
    this.iss = createIssRig(this.panelTexture);
    this.iss.group.visible = false;
    this.generic = createGenericRig(this.panelTexture, INITIAL_CAPACITY);
    this.dots = createDotRig(DOT_CAPACITY);
    this.object = new Group();
    this.object.name = "satellite-models";
    this.object.frustumCulled = false;
    this.object.add(this.iss.group, this.generic.bodyMesh, this.generic.panelMesh, this.dots.mesh);
  }

  sync(points: readonly SatellitePoint[], view: ModelView): void {
    const iss = points.find((point) => point.iss) ?? null;
    const dots = points.filter((point) => !point.iss && point.marker === "dot");
    const others = points.filter((point) => !point.iss && point.marker !== "dot");
    this.issPoint = iss;
    this.dotPoints = dots;
    this.craftPoints = others;
    if (iss) {
      this.placeIss(iss, view);
    } else {
      this.iss.group.visible = false;
    }
    this.placeOthers(others, view);
    this.placeDots(dots, view);
  }

  pick(raycaster: ModelRay): SatellitePoint | null {
    this.object.updateMatrixWorld(true);
    const hit = raycaster.intersectObject(this.object, true)[0];
    if (!hit) {
      return null;
    }
    if (hit.object === this.dots.mesh && typeof hit.instanceId === "number") {
      return this.dotPoints[hit.instanceId] ?? null;
    }
    if (hit.object === this.generic.bodyMesh && typeof hit.instanceId === "number") {
      return this.craftPoints[hit.instanceId] ?? null;
    }
    if (hit.object === this.generic.panelMesh && typeof hit.instanceId === "number") {
      const wings = Math.max(1, this.generic.panelCenters.length);
      return this.craftPoints[Math.floor(hit.instanceId / wings)] ?? null;
    }
    if (this.issPoint && this.belongsToIss(hit.object)) {
      return this.issPoint;
    }
    return null;
  }

  dispose(): void {
    this.iss.group.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry.dispose();
      }
    });
    for (const slot of this.iss.shaded) {
      slot.material.dispose();
    }
    this.generic.bodyMesh.dispose();
    this.generic.panelMesh.dispose();
    for (const geometry of this.generic.geometry) {
      geometry.dispose();
    }
    for (const material of this.generic.materials) {
      material.dispose();
    }
    this.dots.mesh.dispose();
    this.dots.geometry.dispose();
    this.dots.material.dispose();
    this.panelTexture?.dispose();
  }

  private belongsToIss(object: Object3D): boolean {
    let current: Object3D | null = object;
    while (current) {
      if (current === this.iss.group) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  private placeIss(point: SatellitePoint, view: ModelView): void {
    const placed = this.placement(point, view, this.iss.span, ISS_SCREEN_PX);
    this.iss.group.visible = true;
    this.position.set(placed.position.x, placed.position.y, placed.position.z);
    this.quaternion.setFromRotationMatrix(this.basisFrom(placed.frame));
    this.iss.group.position.copy(this.position);
    this.iss.group.quaternion.copy(this.quaternion);
    this.iss.group.scale.set(placed.scale, placed.scale, placed.scale);
    for (const pivot of this.iss.pivots) {
      pivot.rotation.x = placed.frame.panelAngle;
    }
    applyShade(this.iss.shaded, placed.shade);
  }

  private placeOthers(points: readonly SatellitePoint[], view: ModelView): void {
    if (points.length > this.generic.capacity) {
      this.growGeneric(points.length);
    }
    const rig = this.generic;
    const wings = rig.panelCenters.length;
    rig.bodyMesh.count = points.length;
    rig.panelMesh.count = points.length * wings;
    rig.bodyMesh.visible = points.length > 0;
    rig.panelMesh.visible = points.length > 0;

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      if (!point) {
        continue;
      }
      const placed = this.placement(point, view, rig.span, GENERIC_SCREEN_PX);
      this.position.set(placed.position.x, placed.position.y, placed.position.z);
      this.quaternion.setFromRotationMatrix(this.basisFrom(placed.frame));
      this.scale.set(placed.scale, placed.scale, placed.scale);
      this.modelMatrix.compose(this.position, this.quaternion, this.scale);
      rig.bodyMesh.setMatrixAt(index, this.modelMatrix);

      this.spin.makeRotationX(placed.frame.panelAngle);
      for (let wing = 0; wing < wings; wing += 1) {
        const center = rig.panelCenters[wing] ?? { x: 0, y: 0, z: 0 };
        this.shift.makeTranslation(center.x, center.y, center.z);
        this.localMatrix.multiplyMatrices(this.shift, this.spin);
        this.instanceMatrix.multiplyMatrices(this.modelMatrix, this.localMatrix);
        rig.panelMesh.setMatrixAt(index * wings + wing, this.instanceMatrix);
      }

      this.shadeColor.setRGB(placed.shade, placed.shade, placed.shade);
      rig.bodyMesh.setColorAt(index, this.shadeColor);
      for (let wing = 0; wing < wings; wing += 1) {
        rig.panelMesh.setColorAt(index * wings + wing, this.shadeColor);
      }
    }

    rig.bodyMesh.instanceMatrix.needsUpdate = true;
    rig.panelMesh.instanceMatrix.needsUpdate = true;
    if (rig.bodyMesh.instanceColor) {
      rig.bodyMesh.instanceColor.needsUpdate = true;
    }
    if (rig.panelMesh.instanceColor) {
      rig.panelMesh.instanceColor.needsUpdate = true;
    }
  }

  private placeDots(points: readonly SatellitePoint[], view: ModelView): void {
    if (points.length > this.dots.capacity) {
      this.growDots(points.length);
    }
    const mesh = this.dots.mesh;
    mesh.count = points.length;
    mesh.visible = points.length > 0;
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      if (!point) {
        continue;
      }
      const placed = this.placement(point, view, DOT_SPAN, DOT_SCREEN_PX);
      this.position.set(placed.position.x, placed.position.y, placed.position.z);
      this.quaternion.identity();
      this.scale.set(placed.scale, placed.scale, placed.scale);
      this.modelMatrix.compose(this.position, this.quaternion, this.scale);
      mesh.setMatrixAt(index, this.modelMatrix);
      cssColor(point.color, this.dotColor);
      this.shadeColor.setRGB(
        this.dotColor.r * placed.shade,
        this.dotColor.g * placed.shade,
        this.dotColor.b * placed.shade,
      );
      mesh.setColorAt(index, this.shadeColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  }

  private growDots(needed: number): void {
    let capacity = this.dots.capacity;
    while (capacity < needed) {
      capacity *= 2;
    }
    const next = createDotRig(capacity);
    this.object.remove(this.dots.mesh);
    this.dots.mesh.dispose();
    this.dots.geometry.dispose();
    this.dots.material.dispose();
    this.dots = next;
    this.object.add(next.mesh);
  }

  private growGeneric(needed: number): void {
    let capacity = this.generic.capacity;
    while (capacity < needed) {
      capacity *= 2;
    }
    const next = createGenericRig(this.panelTexture, capacity);
    this.object.remove(this.generic.bodyMesh, this.generic.panelMesh);
    this.generic.bodyMesh.dispose();
    this.generic.panelMesh.dispose();
    for (const geometry of this.generic.geometry) {
      geometry.dispose();
    }
    for (const material of this.generic.materials) {
      material.dispose();
    }
    this.generic = next;
    this.object.add(next.bodyMesh, next.panelMesh);
  }

  private basisFrom(frame: SatelliteFrame): Matrix4 {
    this.axisX.set(frame.x.x, frame.x.y, frame.x.z);
    this.axisY.set(frame.y.x, frame.y.y, frame.y.z);
    this.axisZ.set(frame.z.x, frame.z.y, frame.z.z);
    return this.basis.makeBasis(this.axisX, this.axisY, this.axisZ);
  }

  private placement(point: SatellitePoint, view: ModelView, span: number, targetPixels: number): {
    position: Vec3;
    frame: SatelliteFrame;
    scale: number;
    shade: number;
  } {
    const position = globeVector(point.lat, point.lng, point.alt, view.globeRadius);
    const radial = globeVector(point.lat, point.lng, 0, 1);
    const cameraDistance = Math.max(distance(position, view.cameraPosition), 1e-3);
    const scale = screenConstantScale(cameraDistance, view.viewportHeight, view.fovDegrees, span, targetPixels);
    const frame = satelliteFrame(travelDirection(point.velocity, radial), view.sun);
    const inShadow = isInEarthShadow(globeVector(point.lat, point.lng, point.alt, 1), view.sun);
    return {
      position,
      frame,
      scale,
      shade: inShadow ? SHADOW_SHADE : 1,
    };
  }
}

function distance(a: Vec3, b: Vec3): number {
  return lengthOf({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
}
