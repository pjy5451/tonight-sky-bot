import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  type Camera,
  type PerspectiveCamera,
} from "three";
import {
  ISS_GLOW_DIAMETER_PX,
  STAR_COLOR,
  earthBlocksSatellite,
  satellitePaint,
  starSamples,
  type HighlightKind,
} from "./globe-style";
import { GLOBE_SCENE_RADIUS, globeVector } from "./satellite-shape";
import type { SatellitePoint } from "./satellites";

const FIELD_VERTEX = `
attribute float aSize;
attribute float aOpacity;
attribute float aGlow;
attribute float aHide;
varying vec3 vColor;
varying float vOpacity;
varying float vGlow;
varying float vHide;
varying float vSize;
uniform float uPixelRatio;
void main() {
  vColor = color;
  vOpacity = aOpacity;
  vGlow = aGlow;
  vHide = aHide;
  vSize = aSize * uPixelRatio;
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = vSize;
  gl_Position = projectionMatrix * viewPosition;
}
`;

const FIELD_FRAGMENT = `
varying vec3 vColor;
varying float vOpacity;
varying float vGlow;
varying float vHide;
varying float vSize;
void main() {
  if (vHide > 0.5) discard;
  vec2 offset = gl_PointCoord - vec2(0.5);
  float radiusPx = length(offset) * vSize;
  float limit = vSize * 0.5;
  if (radiusPx > limit) discard;
  float alpha = vOpacity;
  if (vGlow > 0.5) {
    float core = 1.0 - smoothstep(1.55, 2.15, radiusPx);
    float glow = (1.0 - smoothstep(2.0, limit, radiusPx)) * 0.42;
    alpha *= max(core, glow);
  } else {
    alpha *= 1.0 - smoothstep(limit * 0.45, limit, radiusPx);
  }
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`;

const STAR_VERTEX = `
attribute float aSize;
attribute float aOpacity;
varying float vOpacity;
uniform float uPixelRatio;
void main() {
  vOpacity = aOpacity;
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio;
  gl_Position = projectionMatrix * viewPosition;
}
`;

const STAR_FRAGMENT = `
varying float vOpacity;
uniform vec3 uColor;
void main() {
  float dist = length(gl_PointCoord - vec2(0.5));
  if (dist > 0.5) discard;
  float alpha = vOpacity * (1.0 - smoothstep(0.2, 0.5, dist));
  gl_FragColor = vec4(uColor, alpha);
}
`;

export type FieldView = {
  cameraPosition: { x: number; y: number; z: number };
  pixelRatio: number;
  highlight: HighlightKind | null;
};

/**
 * 카탈로그 위성과 ISS를 점 하나로 그린다.
 * 그리기 호출은 Points 하나다.
 */
export class SatelliteField {
  readonly points: Points;
  private readonly geometry: BufferGeometry;
  private readonly material: ShaderMaterial;
  private capacity = 0;
  private items: SatellitePoint[] = [];
  private hidden: boolean[] = [];
  private readonly color = new Color();

  constructor() {
    this.geometry = new BufferGeometry();
    this.material = new ShaderMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
      vertexColors: true,
      uniforms: {
        uPixelRatio: { value: 1 },
      },
      vertexShader: FIELD_VERTEX,
      fragmentShader: FIELD_FRAGMENT,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.name = "satellite-field";
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** 위성 점 묶음의 그리기 호출 수. 항상 1이다. */
  drawCallCount(): number {
    return 1;
  }

  sync(points: readonly SatellitePoint[], view: FieldView): void {
    const dots = points.slice();
    this.items = dots.slice();
    this.hidden = new Array(dots.length);
    if (dots.length === 0) {
      this.points.geometry.setDrawRange(0, 0);
      return;
    }
    if (dots.length > this.capacity) {
      this.grow(dots.length);
    }
    const position = this.geometry.getAttribute("position") as BufferAttribute;
    const color = this.geometry.getAttribute("color") as BufferAttribute;
    const size = this.geometry.getAttribute("aSize") as BufferAttribute;
    const opacity = this.geometry.getAttribute("aOpacity") as BufferAttribute;
    const glow = this.geometry.getAttribute("aGlow") as BufferAttribute;
    const hide = this.geometry.getAttribute("aHide") as BufferAttribute;
    const camera = {
      x: view.cameraPosition.x / GLOBE_SCENE_RADIUS,
      y: view.cameraPosition.y / GLOBE_SCENE_RADIUS,
      z: view.cameraPosition.z / GLOBE_SCENE_RADIUS,
    };
    this.material.uniforms.uPixelRatio = { value: view.pixelRatio > 0 ? view.pixelRatio : 1 };

    for (let index = 0; index < dots.length; index += 1) {
      const point = dots[index];
      if (!point) {
        continue;
      }
      const placed = globeVector(point.lat, point.lng, point.alt, GLOBE_SCENE_RADIUS);
      position.setXYZ(index, placed.x, placed.y, placed.z);
      const blocked = earthBlocksSatellite(
        { x: placed.x / GLOBE_SCENE_RADIUS, y: placed.y / GLOBE_SCENE_RADIUS, z: placed.z / GLOBE_SCENE_RADIUS },
        camera,
      );
      this.hidden[index] = blocked;
      const paint = satellitePaint(point, view.highlight);
      this.color.set(paint.color);
      color.setXYZ(index, this.color.r, this.color.g, this.color.b);
      size.setX(index, paint.glow ? ISS_GLOW_DIAMETER_PX : paint.diameterPx);
      opacity.setX(index, paint.opacity);
      glow.setX(index, paint.glow ? 1 : 0);
      hide.setX(index, blocked ? 1 : 0);
    }

    this.points.geometry.setDrawRange(0, dots.length);
    position.needsUpdate = true;
    color.needsUpdate = true;
    size.needsUpdate = true;
    opacity.needsUpdate = true;
    glow.needsUpdate = true;
    hide.needsUpdate = true;
  }

  isHidden(index: number): boolean {
    return this.hidden[index] === true;
  }

  /**
   * 화면 픽셀 거리로 가장 가까운 점을 고른다.
   * `pointerX`·`pointerY`는 캔버스 왼쪽 위 기준이다.
   */
  nearest(
    camera: Camera,
    pointerX: number,
    pointerY: number,
    width: number,
    height: number,
  ): { point: SatellitePoint; distancePx: number } | null {
    if (width < 2 || height < 2) {
      return null;
    }
    const perspective = camera as PerspectiveCamera;
    if (typeof perspective.updateMatrixWorld === "function") {
      perspective.updateMatrixWorld();
    }
    if (typeof perspective.updateProjectionMatrix === "function") {
      perspective.updateProjectionMatrix();
    }
    let best: { point: SatellitePoint; distancePx: number } | null = null;
    for (let index = 0; index < this.items.length; index += 1) {
      if (this.hidden[index]) {
        continue;
      }
      const point = this.items[index];
      const position = this.geometry.getAttribute("position") as BufferAttribute;
      if (!point || !position) {
        continue;
      }
      const clip = project(camera, position.getX(index), position.getY(index), position.getZ(index));
      if (clip.z < -1 || clip.z > 1) {
        continue;
      }
      const screenX = (clip.x * 0.5 + 0.5) * width;
      const screenY = (-clip.y * 0.5 + 0.5) * height;
      const distancePx = Math.hypot(screenX - pointerX, screenY - pointerY);
      const limit = point.iss ? 18 : 14;
      if (distancePx <= limit && (!best || distancePx < best.distancePx)) {
        best = { point, distancePx };
      }
    }
    return best;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  private grow(needed: number): void {
    let capacity = Math.max(256, this.capacity);
    while (capacity < needed) {
      capacity *= 2;
    }
    this.capacity = capacity;
    this.geometry.setAttribute("position", new BufferAttribute(new Float32Array(capacity * 3), 3));
    this.geometry.setAttribute("color", new BufferAttribute(new Float32Array(capacity * 3), 3));
    this.geometry.setAttribute("aSize", new BufferAttribute(new Float32Array(capacity), 1));
    this.geometry.setAttribute("aOpacity", new BufferAttribute(new Float32Array(capacity), 1));
    this.geometry.setAttribute("aGlow", new BufferAttribute(new Float32Array(capacity), 1));
    this.geometry.setAttribute("aHide", new BufferAttribute(new Float32Array(capacity), 1));
  }
}

export class StarField {
  readonly points: Points;
  private readonly material: ShaderMaterial;

  constructor(pixelRatio = 1) {
    const samples = starSamples();
    const geometry = new BufferGeometry();
    const position = new Float32Array(samples.length * 3);
    const size = new Float32Array(samples.length);
    const opacity = new Float32Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      const star = samples[index];
      if (!star) {
        continue;
      }
      position[index * 3] = star.x;
      position[index * 3 + 1] = star.y;
      position[index * 3 + 2] = star.z;
      size[index] = star.sizePx;
      opacity[index] = star.opacity;
    }
    geometry.setAttribute("position", new BufferAttribute(position, 3));
    geometry.setAttribute("aSize", new BufferAttribute(size, 1));
    geometry.setAttribute("aOpacity", new BufferAttribute(opacity, 1));
    const color = new Color(STAR_COLOR);
    this.material = new ShaderMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
      uniforms: {
        uPixelRatio: { value: pixelRatio > 0 ? pixelRatio : 1 },
        uColor: { value: color },
      },
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
    });
    this.points = new Points(geometry, this.material);
    this.points.name = "star-field";
    this.points.frustumCulled = false;
    this.points.renderOrder = 0;
  }

  placeBeyond(_cameraDistance: number, pixelRatio: number): void {
    const shell = GLOBE_SCENE_RADIUS * 80;
    this.points.scale.set(shell, shell, shell);
    this.material.uniforms.uPixelRatio = { value: pixelRatio > 0 ? pixelRatio : 1 };
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

function project(camera: Camera, x: number, y: number, z: number): { x: number; y: number; z: number } {
  const xe = x;
  const ye = y;
  const ze = z;
  const matrix = camera.matrixWorldInverse.elements;
  const viewX = matrix[0]! * xe + matrix[4]! * ye + matrix[8]! * ze + matrix[12]!;
  const viewY = matrix[1]! * xe + matrix[5]! * ye + matrix[9]! * ze + matrix[13]!;
  const viewZ = matrix[2]! * xe + matrix[6]! * ye + matrix[10]! * ze + matrix[14]!;
  const viewW = matrix[3]! * xe + matrix[7]! * ye + matrix[11]! * ze + matrix[15]!;
  const projection = camera.projectionMatrix.elements;
  const clipX = projection[0]! * viewX + projection[4]! * viewY + projection[8]! * viewZ + projection[12]! * viewW;
  const clipY = projection[1]! * viewX + projection[5]! * viewY + projection[9]! * viewZ + projection[13]! * viewW;
  const clipZ = projection[2]! * viewX + projection[6]! * viewY + projection[10]! * viewZ + projection[14]! * viewW;
  const clipW = projection[3]! * viewX + projection[7]! * viewY + projection[11]! * viewZ + projection[15]! * viewW;
  const safe = clipW === 0 ? 1 : clipW;
  return { x: clipX / safe, y: clipY / safe, z: clipZ / safe };
}
