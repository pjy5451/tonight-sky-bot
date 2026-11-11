import {
  MeshPhongMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Texture,
} from "three";
import type { OrbitPath, SatellitePoint } from "./satellites";
import { subsolarPoint } from "./sky";

/**
 * 낮·밤 지구 사진.
 * 개발 때 three-globe 예제 영상(NASA 블루마블·도시 불빛)을 2048×1024 JPEG로 줄여 둔 파일이다.
 */
const EARTH_DAY_URL = `${import.meta.env.BASE_URL}textures/earth-day.jpg`;
const EARTH_NIGHT_URL = `${import.meta.env.BASE_URL}textures/earth-night.jpg`;

/** 태양 직하점을 다시 읽어 낮·밤 경계를 옮기는 간격. */
export const SUNLIGHT_REFRESH_MS = 60_000;

/**
 * MeshPhong 조각 셰이더에서 조명 결과를 내는 줄.
 * 이 줄을 낮 사진과 밤 도시 불빛의 혼합으로 바꾼다.
 */
export const PHONG_OUTGOING_LIGHT =
  "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;";

export type SatelliteGlobe = {
  update(points: SatellitePoint[], paths?: OrbitPath[], focus?: { lat: number; lng: number }): void;
  resize(): void;
  pause(): void;
  resume(): void;
  destroy(): void;
};

export function globePixelRatio(devicePixelRatio: number, narrowScreen: boolean): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(ratio, narrowScreen ? 1.25 : 2);
}

/**
 * three-globe `polar2Cartesian`과 같은 장면 좌표.
 * 위도 0°·경도 0°는 +Z, 북극은 +Y다. 지구본 메시의 Y축 -90° 회전이 이미 반영된 방향이다.
 */
export function sunDirectionFromSubsolar(
  latitude: number,
  longitude: number,
): { x: number; y: number; z: number } {
  const phi = ((90 - latitude) * Math.PI) / 180;
  const theta = ((90 - longitude) * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  return {
    x: sinPhi * Math.cos(theta),
    y: Math.cos(phi),
    z: sinPhi * Math.sin(theta),
  };
}

/**
 * 퐁 조명 대신, 태양 쪽은 낮 사진(`diffuseColor`)을, 밤 쪽은 도시 불빛(`totalEmissiveRadiance`)을 쓴다.
 * `smoothstep` 구간이 낮·밤 경계다.
 */
export function patchDayNightFragmentShader(fragmentShader: string): string {
  if (
    !fragmentShader.includes("#include <common>") ||
    !fragmentShader.includes(PHONG_OUTGOING_LIGHT)
  ) {
    throw new Error("이 three.js 버전에서는 낮·밤 셰이더를 넣을 수 없습니다.");
  }
  return fragmentShader
    .replace("#include <common>", "#include <common>\nuniform vec3 uSunDirection;")
    .replace(
      PHONG_OUTGOING_LIGHT,
      [
        "vec3 sunView = normalize((viewMatrix * vec4(uSunDirection, 0.0)).xyz);",
        "float sunDot = dot(normalize(normal), sunView);",
        "float dayFactor = smoothstep(-0.12, 0.28, sunDot);",
        "vec3 outgoingLight = mix(totalEmissiveRadiance, diffuseColor.rgb, dayFactor);",
      ].join("\n"),
    );
}

export function canRenderGlobe(doc: Document = document): boolean {
  try {
    const canvas = doc.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function isNarrowScreen(): boolean {
  return window.matchMedia("(max-width: 1023px)").matches;
}

function loadEarthTexture(loader: TextureLoader, url: string): Texture {
  const texture = loader.load(url);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export async function mountSatelliteGlobe(container: HTMLElement): Promise<SatelliteGlobe | null> {
  if (!canRenderGlobe(container.ownerDocument)) {
    return null;
  }

  const { default: Globe } = await import("globe.gl");
  const narrow = isNarrowScreen();
  const globe = new Globe(container, {
    animateIn: false,
    rendererConfig: {
      antialias: !narrow,
      alpha: true,
      powerPreference: narrow ? "low-power" : "high-performance",
    },
  });

  globe
    .backgroundColor("rgba(0,0,0,0)")
    .showAtmosphere(true)
    .atmosphereColor("#6CC4FF")
    .atmosphereAltitude(0.18)
    .htmlLat("lat")
    .htmlLng("lng")
    .htmlAltitude("alt")
    .htmlTransitionDuration(0)
    .htmlElement((datum: object) => {
      const point = datum as SatellitePoint;
      const marker = document.createElement("span");
      marker.className = point.iss ? "globe-sat globe-sat-iss" : "globe-sat";
      return marker;
    })
    .pathPoints("points")
    .pathPointLat("lat")
    .pathPointLng("lng")
    .pathPointAlt("alt")
    .pathColor(() => "#F5B544")
    .pathStroke(1.2)
    .pathDashLength(0.4)
    .pathDashGap(0.6)
    .pathDashAnimateTime(0)
    .pathTransitionDuration(0)
    .pointOfView({ lat: 20, lng: 128, altitude: 2.5 });

  const material = globe.globeMaterial();
  if (!(material instanceof MeshPhongMaterial)) {
    globe._destructor();
    throw new Error("지구본 재질에 밤 텍스처를 넣을 수 없습니다.");
  }

  const loader = new TextureLoader();
  const dayTexture = loadEarthTexture(loader, EARTH_DAY_URL);
  const nightTexture = loadEarthTexture(loader, EARTH_NIGHT_URL);
  material.color.setHex(0xffffff);
  material.emissive.setHex(0xffffff);
  material.emissiveIntensity = 1;
  material.map = dayTexture;
  material.emissiveMap = nightTexture;
  material.customProgramCacheKey = () => "argonova-day-night";

  const sunDirection = new Vector3();
  const applySun = (date: Date) => {
    const point = subsolarPoint(date);
    const direction = sunDirectionFromSubsolar(point.latitude, point.longitude);
    sunDirection.set(direction.x, direction.y, direction.z);
  };
  applySun(new Date());
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDirection = { value: sunDirection };
    shader.fragmentShader = patchDayNightFragmentShader(shader.fragmentShader);
  };
  material.needsUpdate = true;

  globe.renderer().setPixelRatio(globePixelRatio(window.devicePixelRatio, narrow));
  const controls = globe.controls();
  controls.autoRotate = false;
  controls.enableDamping = true;

  const resize = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width < 2 || height < 2) {
      return;
    }
    globe.width(width);
    globe.height(height);
  };
  resize();

  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => resize());
  observer?.observe(container);

  const sunTimer = window.setInterval(() => {
    applySun(new Date());
  }, SUNLIGHT_REFRESH_MS);

  return {
    update(points, paths, focus) {
      globe.htmlElementsData(points);
      if (paths) {
        globe.pathsData(paths);
      }
      if (focus) {
        globe.pointOfView({ lat: focus.lat, lng: focus.lng, altitude: 2.5 }, 0);
      }
    },
    resize,
    pause() {
      globe.pauseAnimation();
    },
    resume() {
      applySun(new Date());
      globe.resumeAnimation();
      resize();
    },
    destroy() {
      window.clearInterval(sunTimer);
      observer?.disconnect();
      nightTexture.dispose();
      material.emissiveMap = null;
      globe.pauseAnimation();
      globe._destructor();
    },
  };
}
