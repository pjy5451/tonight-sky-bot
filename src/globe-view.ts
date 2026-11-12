import {
  MeshPhongMaterial,
  Raycaster,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  type Camera,
  type Texture,
} from "three";
import {
  EARTH_BUMP_SCALE,
  EarthTextureSchedule,
  anisotropyLevel,
  startupTextures,
  type PhotoRequest,
  type TextureKind,
  type TextureView,
} from "./earth-textures";
import { SatelliteModels } from "./satellite-mesh";
import {
  GLOBE_SCENE_RADIUS,
  globeVector,
  sunDirectionFromSubsolar,
  type Vec3,
} from "./satellite-shape";
import { ISS_COLOR, OTHER_SATELLITE_COLOR, type OrbitPath, type SatellitePoint } from "./satellites";

export type GlobeMountOptions = {
  onSelect?: (point: SatellitePoint | null) => void;
};
import { subsolarPoint } from "./sky";

export { sunDirectionFromSubsolar };

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

function cameraFov(camera: Camera): number {
  return typeof camera.fov === "number" && camera.fov > 0 ? camera.fov : 50;
}

/**
 * 퐁 조명 대신, 태양 쪽은 낮 사진(`diffuseColor`)을, 밤 쪽은 도시 불빛(`totalEmissiveRadiance`)을 쓴다.
 * `smoothstep` 구간이 낮·밤 경계다. 범프 노멀로 요철을 주고, 바다 맵이 있을 때만 반짝임을 더한다.
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
        "float relief = clamp(0.62 + 0.48 * sunDot, 0.4, 1.2);",
        "vec3 dayColor = diffuseColor.rgb * relief;",
        "#ifdef USE_SPECULARMAP",
        "dayColor += vec3(0.28, 0.36, 0.42) * specularStrength * pow(max(sunDot, 0.0), 36.0);",
        "#endif",
        "vec3 outgoingLight = mix(totalEmissiveRadiance, dayColor, dayFactor);",
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

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

function applySampling(texture: Texture, kind: TextureKind, anisotropy: number): void {
  if (kind === "color") {
    texture.colorSpace = SRGBColorSpace;
  }
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
}

export async function mountSatelliteGlobe(
  container: HTMLElement,
  options: GlobeMountOptions = {},
): Promise<SatelliteGlobe | null> {
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
    .atmosphereColor(OTHER_SATELLITE_COLOR)
    .atmosphereAltitude(0.18)
    .pathPoints("points")
    .pathPointLat("lat")
    .pathPointLng("lng")
    .pathPointAlt("alt")
    .pathColor(() => ISS_COLOR)
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
  const renderer = globe.renderer();
  const anisotropy = anisotropyLevel(renderer.capabilities.getMaxAnisotropy());
  const maxTextureSize = renderer.capabilities.maxTextureSize;
  const schedule = new EarthTextureSchedule();
  const tracked = new Set<Texture>();
  let disposed = false;
  let armUpgrades = false;
  const pendingStartup: Array<"day" | "night"> = [];

  const currentView = (): TextureView => {
    const altitude = globe.pointOfView().altitude;
    return {
      narrow: isNarrowScreen(),
      maxTextureSize,
      altitude: typeof altitude === "number" && Number.isFinite(altitude) ? altitude : 2.5,
    };
  };

  const beginUpgrade = (requests: PhotoRequest[]) => {
    if (requests.length === 0 || disposed) {
      return;
    }
    let remaining = requests.length;
    let failed = false;
    const next = new Map<"day" | "night", Texture>();
    const finish = () => {
      const day = next.get("day");
      const night = next.get("night");
      if (failed || disposed || !day || !night) {
        for (const texture of [day, night]) {
          if (!texture) {
            continue;
          }
          tracked.delete(texture);
          texture.dispose();
        }
        return;
      }
      const previousDay = material.map;
      const previousNight = material.emissiveMap;
      material.map = day;
      material.emissiveMap = night;
      material.needsUpdate = true;
      if (previousDay && previousDay !== day) {
        tracked.delete(previousDay);
        previousDay.dispose();
      }
      if (previousNight && previousNight !== night) {
        tracked.delete(previousNight);
        previousNight.dispose();
      }
    };
    for (const item of requests) {
      const texture = loader.load(
        assetUrl(item.path),
        (loaded) => {
          applySampling(loaded, "color", anisotropy);
          remaining -= 1;
          if (remaining === 0) {
            finish();
          }
        },
        undefined,
        () => {
          failed = true;
          remaining -= 1;
          if (remaining === 0) {
            finish();
          }
        },
      );
      applySampling(texture, "color", anisotropy);
      tracked.add(texture);
      next.set(item.role, texture);
    }
  };

  const flushStartup = (role?: "day" | "night") => {
    if (role) {
      pendingStartup.push(role);
    }
    if (!armUpgrades || disposed) {
      return;
    }
    while (pendingStartup.length > 0) {
      const nextRole = pendingStartup.shift();
      if (nextRole) {
        beginUpgrade(schedule.noteStartupPhoto(nextRole, currentView()));
      }
    }
  };

  const loaded = new Map<string, Texture>();
  for (const item of startupTextures()) {
    const texture = loader.load(
      assetUrl(item.path),
      (ready) => {
        applySampling(ready, item.kind, anisotropy);
        if (item.role === "day" || item.role === "night") {
          flushStartup(item.role);
        }
      },
    );
    applySampling(texture, item.kind, anisotropy);
    tracked.add(texture);
    loaded.set(item.role, texture);
  }

  const dayTexture = loaded.get("day");
  const nightTexture = loaded.get("night");
  const topologyTexture = loaded.get("topology");
  const waterTexture = loaded.get("water");
  if (!dayTexture || !nightTexture || !topologyTexture || !waterTexture) {
    globe._destructor();
    throw new Error("지구본 텍스처를 준비하지 못했습니다.");
  }

  material.color.setHex(0xffffff);
  material.emissive.setHex(0xffffff);
  material.emissiveIntensity = 1;
  material.map = dayTexture;
  material.emissiveMap = nightTexture;
  material.bumpMap = topologyTexture;
  material.bumpScale = EARTH_BUMP_SCALE;
  material.specularMap = waterTexture;
  material.customProgramCacheKey = () => "argonova-day-night";
  armUpgrades = true;
  flushStartup();

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

  const models = new SatelliteModels(anisotropy);
  let latestPoints: SatellitePoint[] = [];
  const markerDatum = { id: "satellites" };
  const syncModels = () => {
    const pov = globe.pointOfView();
    const altitude = typeof pov.altitude === "number" && Number.isFinite(pov.altitude) ? pov.altitude : 2.5;
    const latitude = typeof pov.lat === "number" && Number.isFinite(pov.lat) ? pov.lat : 0;
    const longitude = typeof pov.lng === "number" && Number.isFinite(pov.lng) ? pov.lng : 0;
    const height = container.clientHeight;
    if (height < 2) {
      return;
    }
    const sun: Vec3 = { x: sunDirection.x, y: sunDirection.y, z: sunDirection.z };
    models.sync(latestPoints, {
      globeRadius: GLOBE_SCENE_RADIUS,
      cameraPosition: globeVector(latitude, longitude, altitude, GLOBE_SCENE_RADIUS),
      viewportHeight: height > 1 ? height : 1,
      fovDegrees: cameraFov(globe.camera()),
      sun,
    });
  };
  globe.customLayerData([markerDatum]).customThreeObject(() => models.object).customThreeObjectUpdate(() => {
    syncModels();
  });

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let downX = 0;
  let downY = 0;
  let dragged = false;
  const onPointerDown = (event: PointerEvent) => {
    downX = event.clientX;
    downY = event.clientY;
    dragged = false;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (Math.hypot(event.clientX - downX, event.clientY - downY) > 8) {
      dragged = true;
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    if (disposed || dragged) {
      return;
    }
    const rect = container.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      return;
    }
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, globe.camera());
    options.onSelect?.(models.pick(raycaster));
  };
  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);

  globe.onZoom((pov) => {
    beginUpgrade(
      schedule.noteViewChange({
        narrow: isNarrowScreen(),
        maxTextureSize,
        altitude: pov.altitude,
      }),
    );
    syncModels();
  });

  const resize = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width < 2 || height < 2) {
      return;
    }
    globe.width(width);
    globe.height(height);
    beginUpgrade(schedule.noteViewChange(currentView()));
    syncModels();
  };
  resize();

  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => resize());
  observer?.observe(container);

  const sunTimer = window.setInterval(() => {
    applySun(new Date());
    syncModels();
  }, SUNLIGHT_REFRESH_MS);

  return {
    update(points, paths, focus) {
      latestPoints = points;
      if (paths) {
        globe.pathsData(paths);
      }
      if (focus) {
        globe.pointOfView({ lat: focus.lat, lng: focus.lng, altitude: 2.5 }, 0);
      }
      syncModels();
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
      disposed = true;
      window.clearInterval(sunTimer);
      observer?.disconnect();
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      for (const texture of tracked) {
        texture.dispose();
      }
      tracked.clear();
      models.dispose();
      material.map = null;
      material.emissiveMap = null;
      material.bumpMap = null;
      material.specularMap = null;
      globe.pauseAnimation();
      globe._destructor();
    },
  };
}
