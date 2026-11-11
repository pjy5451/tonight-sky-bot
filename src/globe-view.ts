import type { OrbitPath, SatellitePoint } from "./satellites";

const EARTH_TEXTURE_URL = `${import.meta.env.BASE_URL}textures/earth.png`;

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
    .globeImageUrl(EARTH_TEXTURE_URL)
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
      globe.resumeAnimation();
      resize();
    },
    destroy() {
      observer?.disconnect();
      globe.pauseAnimation();
      globe._destructor();
    },
  };
}
