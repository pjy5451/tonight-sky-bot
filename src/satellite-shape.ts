/**
 * 위성 3D 모형의 부품 비율, 자세, 화면상 크기, 지구 그림자.
 * three.js 없이 계산만 한다. 궤도 기준값은 만들지 않고, 크기는 공개된 ISS 치수의 반올림이다.
 *
 * NASA "International Space Station Facts and Figures": 트러스 끝에서 끝까지 109 m(357 ft).
 * 태양전지판 한 장은 약 35 m × 12 m(112 ft × 39 ft)로 알려졌다. 여기서는 34 m × 12 m로 둔다.
 * 원통 모듈 길이는 즈베즈다·자랴·유니티·데스티니·하모니의 공개 길이를 미터 단위로 반올림한 것이다.
 */

export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type ModelRole = "truss" | "solar-panel" | "module" | "radiator" | "body";

export type ModelPart = {
  role: ModelRole;
  /** 로컬 축 길이. X는 트러스(좌우), Y는 위, Z는 진행 방향. */
  size: Vec3;
  center: Vec3;
};

export type SatelliteModelSpec = {
  kind: "iss" | "generic";
  /**
   * 각도 0인 자세의 부품.
   * 몸체의 +Z가 진행 방향이다.
   * 태양전지판의 넓은 면은 로컬 +Z를 보고, 트러스 축(+X)으로 돌려 태양을 향한다.
   */
  parts: ModelPart[];
  /** 원점에서 가장 먼 부품 모서리까지의 지름. 화면 크기 계산에 쓴다. */
  span: number;
};

export type SatelliteFrame = {
  /** 몸체 축. x는 회전축(트러스), z는 진행 방향. */
  x: Vec3;
  y: Vec3;
  z: Vec3;
  /**
   * 태양전지판을 +X 축으로 돌리는 각도(라디안).
   * 0이면 넓은 면의 법선이 몸체 +Z, 음수면 법선이 몸체 +Y 쪽으로 기운다.
   */
  panelAngle: number;
};

/** three-globe `polar2Cartesian`과 같은 장면 반지름. */
export const GLOBE_SCENE_RADIUS = 100;

/** 화면에서 ISS 모형이 차지할 긴 변. 범례의 ISS 강조를 유지하는 크기. */
export const ISS_SCREEN_PX = 76;

/** 다른 정거장·위성은 ISS보다 작게, 점은 읽히도록. */
export const GENERIC_SCREEN_PX = 34;

/** 지구 그림자 안의 밝기. 햇빛을 받을 때는 1. */
export const SHADOW_SHADE = 0.32;

export const SOLAR_PANEL_NAVY = "#1A2F6B";
export const SOLAR_GRID_LINE = "#A9C0E4";
export const SOLAR_GRID_CELLS = 8;

export const MODEL_COLOR = {
  panel: 0x1a2f6b,
  truss: 0xc5cdd8,
  module: 0xe6edf5,
  radiator: 0xf4f7fb,
  body: 0xc6a15a,
  bodySpecular: 0xffe4a8,
} as const;

const TRUSS_LENGTH = 109;
const TRUSS_HEIGHT = 3.2;
const TRUSS_DEPTH = 4.2;
const PANEL_LENGTH = 34;
const PANEL_WIDTH = 12;
const PANEL_THICKNESS = 0.4;
const PANEL_STATIONS = [-42, -16, 16, 42] as const;
const MODULE_LENGTHS = [13, 12.5, 5.5, 8.5, 7] as const;
const MODULE_DIAMETER = 4.2;
const MODULE_GAP = 0.4;

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lengthOf(value: Vec3): number {
  return Math.hypot(value.x, value.y, value.z);
}

export function scaleVec(value: Vec3, factor: number): Vec3 {
  return { x: value.x * factor, y: value.y * factor, z: value.z * factor };
}

export function normalize(value: Vec3): Vec3 {
  const length = lengthOf(value);
  if (length < 1e-12) {
    return { x: 0, y: 0, z: 1 };
  }
  return scaleVec(value, 1 / length);
}

/**
 * 위도·경도·고도비(지구 반지름 대비)를 장면 좌표로 바꾼다.
 * 위도 0°·경도 0°는 +Z, 북극은 +Y다.
 */
export function globeVector(latitude: number, longitude: number, altitude: number, radius = GLOBE_SCENE_RADIUS): Vec3 {
  const phi = ((90 - latitude) * Math.PI) / 180;
  const theta = ((90 - longitude) * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const distance = radius * (1 + altitude);
  return {
    x: distance * sinPhi * Math.cos(theta),
    y: distance * Math.cos(phi),
    z: distance * sinPhi * Math.sin(theta),
  };
}

/** 태양 직하점의 장면 방향. `globeVector`와 같은 축이다. */
export function sunDirectionFromSubsolar(latitude: number, longitude: number): Vec3 {
  return globeVector(latitude, longitude, 0, 1);
}

/** 속도가 거의 0이면 지면의 동쪽을 진행 방향으로 쓴다. */
export function travelDirection(velocity: Vec3, radial: Vec3): Vec3 {
  if (lengthOf(velocity) > 1e-10) {
    return normalize(velocity);
  }
  let east = cross(radial, { x: 0, y: 1, z: 0 });
  if (lengthOf(east) < 1e-8) {
    east = cross(radial, { x: 1, y: 0, z: 0 });
  }
  return normalize(east);
}

/**
 * 몸체 +Z는 속도, 태양전지판 법선은 태양.
 * 회전축은 둘에 수직이라, 태양이 진행 방향과 나란해도 판을 태양 쪽으로 돌릴 수 있다.
 */
export function satelliteFrame(velocity: Vec3, sun: Vec3): SatelliteFrame {
  const forward = normalize(velocity);
  const sunUnit = normalize(sun);
  let hinge = cross(sunUnit, forward);
  if (lengthOf(hinge) < 1e-8) {
    hinge = cross({ x: 0, y: 1, z: 0 }, forward);
    if (lengthOf(hinge) < 1e-8) {
      hinge = cross({ x: 1, y: 0, z: 0 }, forward);
    }
  }
  const x = normalize(hinge);
  const y = normalize(cross(forward, x));
  const panelAngle = Math.atan2(-dot(sunUnit, y), dot(sunUnit, forward));
  return { x, y, z: forward, panelAngle };
}

/** 회전 뒤 태양전지판의 넓은 면이 가리키는 방향. */
export function panelNormal(frame: SatelliteFrame): Vec3 {
  const sine = Math.sin(frame.panelAngle);
  const cosine = Math.cos(frame.panelAngle);
  return {
    x: frame.y.x * -sine + frame.z.x * cosine,
    y: frame.y.y * -sine + frame.z.y * cosine,
    z: frame.y.z * -sine + frame.z.z * cosine,
  };
}

/**
 * 평행 광선으로 본 지구 그림자.
 * 태양 반대편이고, 지구-태양 축에서의 수직 거리가 지구 반지름보다 작으면 그림자 안이다.
 * 위치는 지구 반지름 단위다.
 */
export function isInEarthShadow(positionEarthRadii: Vec3, sunDirection: Vec3): boolean {
  const sun = normalize(sunDirection);
  const along = dot(positionEarthRadii, sun);
  if (along >= 0) {
    return false;
  }
  const radial2 = dot(positionEarthRadii, positionEarthRadii);
  return radial2 - along * along < 1;
}

export function shadeHex(hex: number, factor: number): number {
  const scale = Math.min(1, Math.max(0, factor));
  const red = Math.round(((hex >> 16) & 255) * scale);
  const green = Math.round(((hex >> 8) & 255) * scale);
  const blue = Math.round((hex & 255) * scale);
  return (red << 16) | (green << 8) | blue;
}

/**
 * 카메라와의 거리에 비례해 세계 크기를 키워, 화면의 픽셀 크기를 줌과 무관하게 유지한다.
 * `distanceToCamera`는 장면 단위, `modelSpan`은 모형 단위(미터)의 긴 변이다.
 */
export function screenConstantScale(
  distanceToCamera: number,
  viewportHeight: number,
  fovDegrees: number,
  modelSpan: number,
  targetPixels: number,
): number {
  if (
    !(distanceToCamera > 0) ||
    !(viewportHeight > 0) ||
    !(fovDegrees > 0) ||
    !(modelSpan > 0) ||
    !(targetPixels > 0)
  ) {
    return 0;
  }
  const visibleHeight = 2 * distanceToCamera * Math.tan((fovDegrees * Math.PI) / 360);
  return ((targetPixels / viewportHeight) * visibleHeight) / modelSpan;
}

export type SolarGridPainter = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  fillRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
};

/** 태양전지판 칸 무늬. 브라우저에서는 캔버스 2D 컨텍스트에 그린다. */
export function paintSolarPanelGrid(painter: SolarGridPainter, size: number): void {
  painter.fillStyle = SOLAR_PANEL_NAVY;
  painter.fillRect(0, 0, size, size);
  painter.strokeStyle = SOLAR_GRID_LINE;
  painter.lineWidth = Math.max(2, Math.round(size / 32));
  const step = size / SOLAR_GRID_CELLS;
  for (let index = 1; index < SOLAR_GRID_CELLS; index += 1) {
    const offset = step * index;
    painter.beginPath();
    painter.moveTo(offset, 0);
    painter.lineTo(offset, size);
    painter.stroke();
    painter.beginPath();
    painter.moveTo(0, offset);
    painter.lineTo(size, offset);
    painter.stroke();
  }
}

function modelSpan(parts: readonly ModelPart[]): number {
  let reach = 0;
  for (const part of parts) {
    reach = Math.max(reach, Math.abs(part.center.x) + part.size.x / 2);
    reach = Math.max(reach, Math.abs(part.center.y) + part.size.y / 2);
    reach = Math.max(reach, Math.abs(part.center.z) + part.size.z / 2);
  }
  return reach * 2;
}

function moduleCenters(lengths: readonly number[], gap: number): number[] {
  const total = lengths.reduce((sum, item) => sum + item, 0) + gap * (lengths.length - 1);
  let cursor = -total / 2;
  return lengths.map((item) => {
    const center = cursor + item / 2;
    cursor += item + gap;
    return center;
  });
}

/** ISS: 긴 트러스, 양쪽 태양전지판 8장, 원통 모듈, 흰 방열판 2장. */
export function issModelSpec(): SatelliteModelSpec {
  const panelClearance = TRUSS_DEPTH / 2 + 0.3;
  const parts: ModelPart[] = [
    {
      role: "truss",
      size: { x: TRUSS_LENGTH, y: TRUSS_HEIGHT, z: TRUSS_DEPTH },
      center: { x: 0, y: 0, z: 0 },
    },
  ];

  for (const station of PANEL_STATIONS) {
    for (const side of [1, -1]) {
      parts.push({
        role: "solar-panel",
        size: { x: PANEL_WIDTH, y: PANEL_LENGTH, z: PANEL_THICKNESS },
        center: {
          x: station,
          y: side * (PANEL_LENGTH / 2 + panelClearance),
          z: 0,
        },
      });
    }
  }

  const centers = moduleCenters(MODULE_LENGTHS, MODULE_GAP);
  MODULE_LENGTHS.forEach((moduleLength, index) => {
    parts.push({
      role: "module",
      size: { x: MODULE_DIAMETER, y: MODULE_DIAMETER, z: moduleLength },
      center: { x: 0, y: 0, z: centers[index] ?? 0 },
    });
  });

  for (const side of [1, -1]) {
    parts.push({
      role: "radiator",
      size: { x: 10, y: 0.35, z: 9 },
      center: { x: side * 29, y: TRUSS_HEIGHT / 2 + 0.5, z: 0 },
    });
  }

  return { kind: "iss", parts, span: modelSpan(parts) };
}

/** 다른 위성: 금박 상자 하나와 좌우 태양전지판 두 장. */
export function genericSatelliteSpec(): SatelliteModelSpec {
  const body: ModelPart = {
    role: "body",
    size: { x: 2.4, y: 2.2, z: 3.6 },
    center: { x: 0, y: 0, z: 0 },
  };
  const wingLength = 7.2;
  const parts: ModelPart[] = [body];
  for (const side of [1, -1]) {
    parts.push({
      role: "solar-panel",
      size: { x: wingLength, y: 2, z: 0.16 },
      center: { x: side * (body.size.x / 2 + wingLength / 2), y: 0, z: 0 },
    });
  }
  return { kind: "generic", parts, span: modelSpan(parts) };
}

export type ModelView = {
  globeRadius: number;
  cameraPosition: Vec3;
  viewportHeight: number;
  fovDegrees: number;
  sun: Vec3;
};
