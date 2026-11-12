import { constants } from "satellite.js";
import {
  Group,
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
import {
  ATMOSPHERE_ALTITUDE,
  ATMOSPHERE_COLOR,
  CITY_LIGHT_COLOR,
  ISS_ORBIT_WIDTH_PX,
  NIGHT_VEIL_COLOR,
  NIGHT_VEIL_MAX,
  NIGHT_VEIL_MIN,
  SELECTED_ORBIT_WIDTH_PX,
  earthFrameAltitude,
  geoFitAltitude,
  hexToUnitRgb,
  issOrbitColor,
  selectedOrbitColor,
  type HighlightKind,
} from "./globe-style";
import { SatelliteField, StarField } from "./satellite-field";
import { SatelliteModels } from "./satellite-mesh";
import {
  GLOBE_SCENE_RADIUS,
  globeVector,
  sunDirectionFromSubsolar,
  type Vec3,
} from "./satellite-shape";
import { type OrbitPath, type SatellitePoint } from "./satellites";

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

export type GlobeFrame = {
  highlight: HighlightKind | null;
  selectedPaths?: OrbitPath[];
};

export type GlobeFocus = {
  lat: number;
  lng: number;
  /** 0이면 바로 맞추고, 양수면 그 밀리초 동안 돈다. */
  durationMs?: number;
};

export type SatelliteGlobe = {
  update(
    points: SatellitePoint[],
    paths?: OrbitPath[],
    focus?: GlobeFocus,
    frame?: GlobeFrame,
  ): void;
  resize(): void;
  pause(): void;
  resume(): void;
  destroy(): void;
};

type DrawnPath = OrbitPath & { role: "iss" | "selected" };

const NIGHT_VEIL_RGB = hexToUnitRgb(NIGHT_VEIL_COLOR);
const CITY_LIGHT_RGB = hexToUnitRgb(CITY_LIGHT_COLOR);

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
        `float nightCover = mix(${NIGHT_VEIL_MIN.toFixed(2)}, ${NIGHT_VEIL_MAX.toFixed(2)}, smoothstep(0.2, -0.55, sunDot));`,
        `vec3 cityLights = totalEmissiveRadiance * vec3(${CITY_LIGHT_RGB.map((channel) => channel.toFixed(6)).join(", ")});`,
        "float cityAmount = clamp(max(cityLights.r, max(cityLights.g, cityLights.b)), 0.0, 1.0);",
        `vec3 veiledNight = mix(cityLights, vec3(${NIGHT_VEIL_RGB.map((channel) => channel.toFixed(6)).join(", ")}), nightCover);`,
        "totalEmissiveRadiance = mix(veiledNight, cityLights, smoothstep(0.08, 0.45, cityAmount));",
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
    .atmosphereColor(ATMOSPHERE_COLOR)
    .atmosphereAltitude(ATMOSPHERE_ALTITUDE)
    .pathPoints("points")
    .pathPointLat("lat")
    .pathPointLng("lng")
    .pathPointAlt("alt")
    .pathColor((item: object) => ((item as DrawnPath).role === "iss" ? issOrbitColor() : selectedOrbitColor()))
    .pathStroke((item: object) => ((item as DrawnPath).role === "iss" ? ISS_ORBIT_WIDTH_PX : SELECTED_ORBIT_WIDTH_PX))
    .pathDashLength((item: object) => ((item as DrawnPath).role === "iss" ? 0.02 : 1))
    .pathDashGap((item: object) => ((item as DrawnPath).role === "iss" ? 0.016 : 0))
    .pathDashAnimateTime(0)
    .pathTransitionDuration(0);

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
  const viewCamera = globe.camera();
  if (typeof viewCamera.far === "number") {
    viewCamera.far = Math.max(viewCamera.far, GLOBE_SCENE_RADIUS * 200);
    viewCamera.updateProjectionMatrix();
  }
  const controls = globe.controls();
  controls.autoRotate = false;
  controls.enableDamping = true;
  const geoDistance = GLOBE_SCENE_RADIUS * (geoFitAltitude(cameraFov(globe.camera()), constants.earthRadius) + 1.2);
  if (!(controls.maxDistance >= geoDistance)) {
    controls.maxDistance = geoDistance;
  }

  const models = new SatelliteModels(anisotropy);
  const field = new SatelliteField();
  const stars = new StarField(globe.renderer().getPixelRatio());
  const layer = new Group();
  layer.name = "satellite-layer";
  layer.frustumCulled = false;
  layer.add(stars.points, models.object, field.points);

  let latestPoints: SatellitePoint[] = [];
  let issPaths: OrbitPath[] = [];
  let selectedPaths: OrbitPath[] = [];
  let highlight: HighlightKind | null = null;
  let frameAltitude = earthFrameAltitude(cameraFov(globe.camera()), 1);
  let userZoomed = false;
  let framing = false;
  let hasFrame = false;
  const markerDatum = { id: "satellites" };

  const frameCamera = (lat?: number, lng?: number) => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    const aspect = width > 1 && height > 1 ? width / height : 1;
    frameAltitude = earthFrameAltitude(cameraFov(globe.camera()), aspect);
    const pov = globe.pointOfView();
    const nextLat = lat ?? (typeof pov.lat === "number" && Number.isFinite(pov.lat) ? pov.lat : 20);
    const nextLng = lng ?? (typeof pov.lng === "number" && Number.isFinite(pov.lng) ? pov.lng : 128);
    framing = true;
    globe.pointOfView({ lat: nextLat, lng: nextLng, altitude: frameAltitude }, 0);
    framing = false;
  };

  const publishPaths = () => {
    const drawn: DrawnPath[] = [
      ...issPaths.map((path) => ({ ...path, role: "iss" as const })),
      ...selectedPaths.map((path) => ({ ...path, role: "selected" as const })),
    ];
    globe.pathsData(drawn);
  };

  const syncScene = () => {
    const pov = globe.pointOfView();
    const altitude = typeof pov.altitude === "number" && Number.isFinite(pov.altitude) ? pov.altitude : frameAltitude;
    const latitude = typeof pov.lat === "number" && Number.isFinite(pov.lat) ? pov.lat : 0;
    const longitude = typeof pov.lng === "number" && Number.isFinite(pov.lng) ? pov.lng : 0;
    const height = container.clientHeight;
    if (height < 2) {
      return;
    }
    const camera = globe.camera();
    const cameraPosition = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    };
    const fallback = globeVector(latitude, longitude, altitude, GLOBE_SCENE_RADIUS);
    const placed =
      Math.hypot(cameraPosition.x, cameraPosition.y, cameraPosition.z) > 1 ? cameraPosition : fallback;
    const sun: Vec3 = { x: sunDirection.x, y: sunDirection.y, z: sunDirection.z };
    const pixelRatio = globe.renderer().getPixelRatio();
    // 28번: 화면의 위성은 작은 점이다. 3D 모형 코드는 두되 지구본에는 그리지 않는다.
    models.sync([], {
      globeRadius: GLOBE_SCENE_RADIUS,
      cameraPosition: placed,
      viewportHeight: height,
      fovDegrees: cameraFov(camera),
      sun,
    });
    field.sync(latestPoints, { cameraPosition: placed, pixelRatio, highlight });
    stars.placeBeyond(Math.hypot(placed.x, placed.y, placed.z), pixelRatio);
  };
  globe.customLayerData([markerDatum]).customThreeObject(() => layer).customThreeObjectUpdate(() => {
    syncScene();
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
    const near = field.nearest(
      globe.camera(),
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
    );
    const modelHit = models.pick(raycaster);
    if (near && near.distancePx <= 8) {
      options.onSelect?.(near.point);
      return;
    }
    options.onSelect?.(modelHit ?? near?.point ?? null);
  };
  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);

  globe.onZoom((pov) => {
    if (!framing && Math.abs(pov.altitude - frameAltitude) > 0.08) {
      userZoomed = true;
    }
    beginUpgrade(
      schedule.noteViewChange({
        narrow: isNarrowScreen(),
        maxTextureSize,
        altitude: pov.altitude,
      }),
    );
    syncScene();
  });

  const resize = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width < 2 || height < 2) {
      return;
    }
    globe.width(width);
    globe.height(height);
    if (!userZoomed) {
      if (!hasFrame) {
        frameCamera(20, 128);
        hasFrame = true;
      } else {
        frameCamera();
      }
    }
    beginUpgrade(schedule.noteViewChange(currentView()));
    syncScene();
  };
  resize();

  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => resize());
  observer?.observe(container);

  const sunTimer = window.setInterval(() => {
    applySun(new Date());
    syncScene();
  }, SUNLIGHT_REFRESH_MS);

  return {
    update(points, paths, focus, frame) {
      latestPoints = points;
      if (paths) {
        issPaths = paths;
      }
      if (frame) {
        highlight = frame.highlight;
        selectedPaths = frame.selectedPaths ?? [];
      }
      publishPaths();
      if (focus) {
        const duration = focus.durationMs ?? 0;
        if (duration > 0) {
          const pov = globe.pointOfView();
          const altitude =
            typeof pov.altitude === "number" && Number.isFinite(pov.altitude) ? pov.altitude : frameAltitude;
          framing = true;
          globe.pointOfView({ lat: focus.lat, lng: focus.lng, altitude }, duration);
          window.setTimeout(() => {
            framing = false;
          }, duration);
        } else {
          userZoomed = false;
          hasFrame = true;
          frameCamera(focus.lat, focus.lng);
        }
      }
      syncScene();
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
      field.dispose();
      stars.dispose();
      material.map = null;
      material.emissiveMap = null;
      material.bumpMap = null;
      material.specularMap = null;
      globe.pauseAnimation();
      globe._destructor();
    },
  };
}
