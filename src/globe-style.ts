import { FILTER_GROUPS, type GlobeFilter } from "./catalog";

/**
 * 지구본 위성 점의 화면 크기·색·불투명도.
 * 확대해도 픽셀 크기는 그대로다. 일반 점은 3px를 넘기지 않는다.
 */

export const SAT_DOT_COLOR = "#DDE6F5";
export const SAT_DOT_DIAMETER_PX = 2;
export const SAT_DOT_DIAMETER_MAX_PX = 3;
export const SAT_DOT_OPACITY_MIN = 0.35;
export const SAT_DOT_OPACITY_MAX = 0.9;
export const SAT_DIM_OPACITY = 0.15;

export const ISS_DOT_COLOR = "#E8B04A";
export const ISS_DOT_DIAMETER_PX = 4;
/** 4px 점 둘레의 은은한 번짐이 들어가는 스프라이트 지름. */
export const ISS_GLOW_DIAMETER_PX = 14;
export const ISS_ORBIT_OPACITY = 0.6;
export const ISS_ORBIT_WIDTH_PX = 1;
export const SELECTED_ORBIT_WIDTH_PX = 1;
export const SELECTED_ORBIT_COLOR = "#DDE6F5";
export const SELECTED_ORBIT_OPACITY = 0.85;

export const STAR_COLOR = "#DDE6F5";
export const STAR_DIAMETER_MIN_PX = 0.5;
export const STAR_DIAMETER_MAX_PX = 1.2;
export const STAR_OPACITY_MIN = 0.35;
export const STAR_OPACITY_MAX = 0.9;
export const STAR_COUNT = 160;

/** 시안의 밤 베일. 낮·밤 경계 쪽은 0.86, 깊은 밤은 0.94. */
export const NIGHT_VEIL_COLOR = "#03050A";
export const NIGHT_VEIL_MIN = 0.86;
export const NIGHT_VEIL_MAX = 0.94;
export const CITY_LIGHT_COLOR = "#FFD58A";

/** 가장자리 한 겹. globe.gl 대기 두께는 지구 반지름 대비. */
export const ATMOSPHERE_COLOR = "#7FD3FF";
export const ATMOSPHERE_ALTITUDE = 0.06;

/** 기본 시점에서 지구 지름이 지구본 영역 짧은 변에서 차지하는 비율. */
export const EARTH_SHORT_SIDE_FRACTION = 0.6;

/**
 * 정지궤도 고도. NOAA/NASA가 쓰는 약 35,786 km.
 * 지구 반지름은 호출하는 쪽에서 satellite.js `constants.earthRadius`를 넘긴다.
 */
export const GEOSTATIONARY_ALTITUDE_KM = 35786;

export const FILTER_HIGHLIGHT_COLOR = {
  korea: "#FF7A59",
  starlink: "#A9B8D6",
  nav: "#7BD88F",
  geo: "#C59BFF",
} as const;

export type HighlightKind = keyof typeof FILTER_HIGHLIGHT_COLOR;

export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type DotPaint = {
  color: string;
  opacity: number;
  diameterPx: number;
  /** 앰버 점과 빛 번짐을 그릴 때 true. 흐려진 ISS는 일반 점이다. */
  glow: boolean;
};

const NAV_GROUPS = new Set(["gps-ops", "galileo"]);

/** 0 이상 1 미만의 고정 소수. 같은 번호는 항상 같은 불투명도다. */
export function unitFromId(id: number): number {
  const value = Math.abs(Math.sin(id * 12.9898 + 78.233) * 43758.5453);
  return value - Math.floor(value);
}

export function clampDotDiameter(pixels: number): number {
  if (!Number.isFinite(pixels)) {
    return SAT_DOT_DIAMETER_PX;
  }
  return Math.min(SAT_DOT_DIAMETER_MAX_PX, Math.max(1, pixels));
}

/**
 * 전체가 켜져 있으면 null(무채색).
 * 한 종류만 켜져 있거나 '한국 위성만'이면 그 종류 색을 쓰고 나머지는 흐리게 둔다.
 */
export function exclusiveHighlight(filter: GlobeFilter): HighlightKind | null {
  if (filter.koreaOnly) {
    return "korea";
  }
  const enabled = FILTER_GROUPS.filter((group) => filter.enabled[group]);
  if (enabled.length === 1) {
    const only = enabled[0];
    if (only === "starlink" || only === "geo" || only === "korea") {
      return only;
    }
    if (only === "gps-ops" || only === "galileo") {
      return "nav";
    }
    return null;
  }
  if (enabled.length === 2 && enabled.every((group) => NAV_GROUPS.has(group))) {
    return "nav";
  }
  return null;
}

export function matchesHighlight(
  point: { group?: string; korean?: boolean },
  highlight: HighlightKind,
): boolean {
  if (highlight === "korea") {
    return point.korean === true || point.group === "korea";
  }
  if (highlight === "starlink") {
    return point.group === "starlink";
  }
  if (highlight === "geo") {
    return point.group === "geo";
  }
  return point.group === "gps-ops" || point.group === "galileo";
}

export function satellitePaint(
  point: { noradId?: number; iss?: boolean; group?: string; korean?: boolean },
  highlight: HighlightKind | null,
): DotPaint {
  const faded = highlight !== null && !matchesHighlight(point, highlight);
  if (point.iss && !faded) {
    return {
      color: ISS_DOT_COLOR,
      opacity: 1,
      diameterPx: ISS_DOT_DIAMETER_PX,
      glow: true,
    };
  }
  if (faded) {
    return {
      color: SAT_DOT_COLOR,
      opacity: SAT_DIM_OPACITY,
      diameterPx: SAT_DOT_DIAMETER_PX,
      glow: false,
    };
  }
  if (highlight) {
    return {
      color: FILTER_HIGHLIGHT_COLOR[highlight],
      opacity: SAT_DOT_OPACITY_MAX,
      diameterPx: SAT_DOT_DIAMETER_PX,
      glow: false,
    };
  }
  const span = SAT_DOT_OPACITY_MAX - SAT_DOT_OPACITY_MIN;
  return {
    color: SAT_DOT_COLOR,
    opacity: SAT_DOT_OPACITY_MIN + unitFromId(point.noradId ?? 0) * span,
    diameterPx: clampDotDiameter(SAT_DOT_DIAMETER_PX),
    glow: false,
  };
}

export function issOrbitColor(): string {
  return `rgba(232, 176, 74, ${ISS_ORBIT_OPACITY})`;
}

export function selectedOrbitColor(): string {
  return `rgba(221, 230, 245, ${SELECTED_ORBIT_OPACITY})`;
}

/**
 * 카메라에서 위성으로 가는 선분이 지구(반지름 1) 안을 지나면 가려진다.
 * 위치는 지구 반지름 단위다.
 */
export function earthBlocksSatellite(satellite: Vec3, camera: Vec3, earthRadius = 1): boolean {
  const dx = satellite.x - camera.x;
  const dy = satellite.y - camera.y;
  const dz = satellite.z - camera.z;
  const length2 = dx * dx + dy * dy + dz * dz;
  if (length2 < 1e-12) {
    return false;
  }
  const raw = -(camera.x * dx + camera.y * dy + camera.z * dz) / length2;
  const t = Math.min(1, Math.max(0, raw));
  if (t > 0.999) {
    return false;
  }
  const closestX = camera.x + dx * t;
  const closestY = camera.y + dy * t;
  const closestZ = camera.z + dz * t;
  return closestX * closestX + closestY * closestY + closestZ * closestZ < earthRadius * earthRadius;
}

/**
 * 지구 지름이 뷰포트 짧은 변의 `fraction`이 되는 카메라 고도(지구 반지름 단위, 표면 위).
 * `aspect`는 가로/세로. 세로는 three.js 카메라의 수직 시야각이다.
 */
export function earthFrameAltitude(fovDegrees: number, aspect: number, fraction = EARTH_SHORT_SIDE_FRACTION): number {
  const halfTan = Math.tan((fovDegrees * Math.PI) / 360);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (!(halfTan > 0) || !(fraction > 0) || !(fraction < 1)) {
    return 2.5;
  }
  const heightFraction = safeAspect < 1 ? fraction * safeAspect : fraction;
  return 1 / (heightFraction * halfTan) - 1;
}

/** 이 고도에서 지구 지름이 세로 화각 중 차지하는 비율. */
export function earthHeightFraction(altitude: number, fovDegrees: number): number {
  const halfTan = Math.tan((fovDegrees * Math.PI) / 360);
  if (!(halfTan > 0) || !Number.isFinite(altitude)) {
    return 0;
  }
  return 1 / ((1 + altitude) * halfTan);
}

/**
 * 화면 가운데를 볼 때 정지궤도 고리 전체가 들어오는 최소 고도.
 * `earthRadiusKm`는 궤도 라이브러리의 지구 반지름이다.
 */
export function geoFitAltitude(fovDegrees: number, earthRadiusKm: number): number {
  const halfTan = Math.tan((fovDegrees * Math.PI) / 360);
  if (!(halfTan > 0) || !(earthRadiusKm > 0)) {
    return 20;
  }
  const ringRadii = 1 + GEOSTATIONARY_ALTITUDE_KM / earthRadiusKm;
  return ringRadii / halfTan - 1;
}

export type StarSample = {
  x: number;
  y: number;
  z: number;
  sizePx: number;
  opacity: number;
};

/** 단위 구 위의 배경 별. 시드가 고정이라 새로고침해도 자리가 같다. */
export function starSamples(count = STAR_COUNT): StarSample[] {
  let state = 0x6d2b79f5;
  const next = () => {
    state = Math.imul(state, 1664525) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
  const stars: StarSample[] = [];
  const sizeSpan = STAR_DIAMETER_MAX_PX - STAR_DIAMETER_MIN_PX;
  const opacitySpan = STAR_OPACITY_MAX - STAR_OPACITY_MIN;
  for (let index = 0; index < count; index += 1) {
    const z = next() * 2 - 1;
    const angle = next() * Math.PI * 2;
    const ring = Math.sqrt(Math.max(0, 1 - z * z));
    stars.push({
      x: ring * Math.cos(angle),
      y: ring * Math.sin(angle),
      z,
      sizePx: STAR_DIAMETER_MIN_PX + next() * sizeSpan,
      opacity: STAR_OPACITY_MIN + next() * opacitySpan,
    });
  }
  return stars;
}

export function hexToUnitRgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  const value = match ? Number.parseInt(match[1] ?? "000000", 16) : 0;
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
