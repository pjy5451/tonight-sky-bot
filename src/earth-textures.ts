/**
 * 지구본 텍스처를 어느 순서로 요청할지 정한다.
 * 경로는 `public/` 기준이고, 브라우저가 외부 주소로 사진을 받지 않도록 상대 경로만 둔다.
 */

export const BASE_PHOTO_EDGE = 2048;
export const MOBILE_PHOTO_EDGE = 4096;
export const DESKTOP_PHOTO_EDGE = 8192;

/** 휴대폰은 이 고도 이하로 확대되기 전에는 4K를 받지 않는다. 처음 카메라 고도는 2.5다. */
export const ZOOM_IN_ALTITUDE = 1.8;

/** three-globe 예제와 같은 지형 요철 강도. */
export const EARTH_BUMP_SCALE = 10;

export const TOPOLOGY_PATH = "textures/earth-topology.png";
export const WATER_PATH = "textures/earth-water.png";

export type PhotoEdge = 2048 | 4096 | 8192;
export type TextureKind = "color" | "data";
export type StartupRole = "day" | "night" | "topology" | "water";

export type StartupTexture = {
  role: StartupRole;
  path: string;
  kind: TextureKind;
};

export type PhotoRequest = {
  role: "day" | "night";
  path: string;
  edge: PhotoEdge;
};

export type TextureView = {
  narrow: boolean;
  maxTextureSize: number;
  altitude: number;
};

const PHOTOS: Record<PhotoEdge, { day: string; night: string }> = {
  2048: { day: "textures/earth-day.jpg", night: "textures/earth-night.jpg" },
  4096: { day: "textures/earth-day-4k.jpg", night: "textures/earth-night-4k.jpg" },
  8192: { day: "textures/earth-day-8k.jpg", night: "textures/earth-night-8k.jpg" },
};

export function startupTextures(): StartupTexture[] {
  return [
    { role: "day", path: PHOTOS[2048].day, kind: "color" },
    { role: "night", path: PHOTOS[2048].night, kind: "color" },
    { role: "topology", path: TOPOLOGY_PATH, kind: "data" },
    { role: "water", path: WATER_PATH, kind: "data" },
  ];
}

/**
 * GPU가 받는 한 변의 최대 길이 안에서, 목표 해상도 이하로 맞춘다.
 * 8192짜리 파일은 maxTextureSize가 8192 이상일 때만 고른다.
 */
export function photoEdgeFor(targetEdge: number, maxTextureSize: number): PhotoEdge {
  const cap = Number.isFinite(maxTextureSize) && maxTextureSize > 0 ? maxTextureSize : BASE_PHOTO_EDGE;
  const allowed = Math.min(targetEdge, cap);
  if (allowed >= DESKTOP_PHOTO_EDGE) {
    return DESKTOP_PHOTO_EDGE;
  }
  if (allowed >= MOBILE_PHOTO_EDGE) {
    return MOBILE_PHOTO_EDGE;
  }
  return BASE_PHOTO_EDGE;
}

/** 장치가 허용하는 이방성 필터의 최댓값. 숫자가 아니면 1. */
export function anisotropyLevel(maxAnisotropy: number): number {
  if (!Number.isFinite(maxAnisotropy) || maxAnisotropy < 1) {
    return 1;
  }
  return maxAnisotropy;
}

/**
 * 2K 낮·밤 사진이 준비된 뒤에만 고해상도를 요청한다.
 * 넓은 화면은 곧장 8K(GPU 한도 이하면 4K), 좁은 화면은 확대 후에만 4K.
 */
export class EarthTextureSchedule {
  private dayReady = false;
  private nightReady = false;
  private upgraded = false;

  noteStartupPhoto(role: "day" | "night", view: TextureView): PhotoRequest[] {
    if (role === "day") {
      this.dayReady = true;
    } else {
      this.nightReady = true;
    }
    return this.upgrade(view);
  }

  noteViewChange(view: TextureView): PhotoRequest[] {
    return this.upgrade(view);
  }

  private upgrade(view: TextureView): PhotoRequest[] {
    if (this.upgraded || !this.dayReady || !this.nightReady) {
      return [];
    }
    const target = view.narrow ? MOBILE_PHOTO_EDGE : DESKTOP_PHOTO_EDGE;
    if (view.narrow && !(view.altitude <= ZOOM_IN_ALTITUDE)) {
      return [];
    }
    const edge = photoEdgeFor(target, view.maxTextureSize);
    if (edge === BASE_PHOTO_EDGE) {
      return [];
    }
    this.upgraded = true;
    const pair = PHOTOS[edge];
    return [
      { role: "day", path: pair.day, edge },
      { role: "night", path: pair.night, edge },
    ];
  }
}
