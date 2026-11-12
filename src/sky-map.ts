import {
  Body,
  Equator,
  Horizon,
  HorizonFromVector,
  Observer,
  RotateVector,
  Rotation_EQJ_HOR,
  Spherical,
  VectorFromSphere,
} from "astronomy-engine";
import { planetNameKey, translate, type Locale, type MessageKey } from "./i18n";
import { formatKstTime } from "./sky";

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW = 200;
const CENTER = 100;
const RADIUS = 84;
const MAG_LIMIT = 5.5;
const STAR_FILL = "#E9EDF5";
const LINE_STROKE = "#8A94A8";
const RIM_STROKE = "#7C869A";
const AMBER = "#E8B04A";

const CHART_BODIES = [
  { id: "venus", body: Body.Venus },
  { id: "mars", body: Body.Mars },
  { id: "jupiter", body: Body.Jupiter },
  { id: "saturn", body: Body.Saturn },
] as const;

const CARDINALS = [
  { azimuth: 0, key: "compassNorth" },
  { azimuth: 90, key: "compassEast" },
  { azimuth: 180, key: "compassSouth" },
  { azimuth: 270, key: "compassWest" },
] as const satisfies ReadonlyArray<{ azimuth: number; key: MessageKey }>;

export type StarRecord = {
  hr: number;
  raHours: number;
  decDeg: number;
  mag: number;
};

export type StarCatalog = {
  stars: StarRecord[];
  lines: Array<[number, number]>;
};

export type SkyTrackPoint = {
  time: Date;
  azimuth: number;
  elevation: number;
  mark: boolean;
};

export type SkyMapModel = {
  locale: Locale;
  place: { latitude: number; longitude: number } | null;
  date: Date;
  stars: StarCatalog | null;
  starStatus: "loading" | "ready" | "error";
  issTrack: readonly SkyTrackPoint[];
};

type Point = { x: number; y: number };

type OrientationReading = {
  alpha: number | null;
  absolute: boolean;
  webkitCompassHeading?: number | null;
};

function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * `public/data/stars.json`.
 * 별은 [HR, 적경(시), 적위(도), 시각등급]이고 별자리 선은 HR 쌍이다.
 */
export function parseStarCatalog(payload: unknown): StarCatalog | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as { stars?: unknown; lines?: unknown };
  if (!Array.isArray(record.stars) || !Array.isArray(record.lines)) {
    return null;
  }
  const stars: StarRecord[] = [];
  const seen = new Set<number>();
  for (const row of record.stars) {
    if (!Array.isArray(row) || row.length < 4) {
      return null;
    }
    const [hr, raHours, decDeg, mag] = row;
    if (!isFiniteNumber(hr) || !isFiniteNumber(raHours) || !isFiniteNumber(decDeg) || !isFiniteNumber(mag)) {
      return null;
    }
    if (hr <= 0 || raHours < 0 || raHours >= 24 || decDeg < -90 || decDeg > 90 || mag > MAG_LIMIT + 0.001) {
      return null;
    }
    const id = Math.round(hr);
    if (seen.has(id)) {
      return null;
    }
    seen.add(id);
    stars.push({ hr: id, raHours, decDeg, mag });
  }
  if (stars.length === 0) {
    return null;
  }
  const lines: Array<[number, number]> = [];
  for (const row of record.lines) {
    if (!Array.isArray(row) || row.length < 2) {
      return null;
    }
    const [from, to] = row;
    if (!isFiniteNumber(from) || !isFiniteNumber(to)) {
      return null;
    }
    const start = Math.round(from);
    const end = Math.round(to);
    if (!seen.has(start) || !seen.has(end) || start === end) {
      continue;
    }
    lines.push([start, end]);
  }
  return { stars, lines };
}

/**
 * J2000 적경·적위를 관측자의 고도·방위로 바꾼다.
 * astronomy-engine의 J2000 적도 → 지평 회전과 표준 대기굴절을 쓴다.
 * 적경은 시간각이 아니라 항성시(0–24시)다.
 */
export function horizontalFromJ2000(
  date: Date,
  place: { latitude: number; longitude: number },
  raHours: number,
  decDeg: number,
): { azimuth: number; altitude: number } {
  const observer = new Observer(place.latitude, place.longitude, 0);
  const equatorial = VectorFromSphere(new Spherical(decDeg, normalizeDegrees(raHours * 15), 1), date);
  const horizontal = RotateVector(Rotation_EQJ_HOR(date, observer), equatorial);
  const sphere = HorizonFromVector(horizontal, "normal");
  return {
    azimuth: normalizeDegrees(sphere.lon),
    altitude: sphere.lat,
  };
}

/**
 * 천정이 가운데, 지평선이 원 테두리인 전천 도법.
 * 방위 0°(북)는 위, 동은 오른쪽. 고도가 0보다 낮으면 원 밖이라 null.
 */
export function projectAllSky(azimuthDeg: number, altitudeDeg: number, radius: number): Point | null {
  if (!Number.isFinite(azimuthDeg) || !Number.isFinite(altitudeDeg) || altitudeDeg < 0 || radius <= 0) {
    return null;
  }
  const reach = radius * ((90 - Math.min(altitudeDeg, 90)) / 90);
  const azimuth = (normalizeDegrees(azimuthDeg) * Math.PI) / 180;
  return {
    x: reach * Math.sin(azimuth),
    y: -reach * Math.cos(azimuth),
  };
}

/**
 * 가로로 끌면 지도가 돌아 천정 위쪽에 오는 방위가 바뀐다.
 * 너비만큼 끌면 180°다. 너비를 모르면 320px로 본다.
 */
export function bearingAfterDrag(bearingDeg: number, deltaXPx: number, widthPx: number): number {
  const width = widthPx > 1 ? widthPx : 320;
  return normalizeDegrees(bearingDeg + (-deltaXPx / width) * 180);
}

/**
 * 기기 윗면이 가리키는 나침반 방위.
 * iOS는 webkitCompassHeading, 절대 방향 이벤트는 360−alpha를 쓴다.
 * 상대 alpha만 있으면 북쪽을 알 수 없으므로 null.
 */
export function headingFromOrientation(reading: OrientationReading): number | null {
  const webkit = reading.webkitCompassHeading;
  if (typeof webkit === "number" && Number.isFinite(webkit)) {
    return normalizeDegrees(webkit);
  }
  if (reading.absolute && typeof reading.alpha === "number" && Number.isFinite(reading.alpha)) {
    return normalizeDegrees(360 - reading.alpha);
  }
  return null;
}

function formatBearing(degrees: number): string {
  return (Math.round(normalizeDegrees(degrees) * 10) / 10).toFixed(1);
}

function starRadius(mag: number): number {
  const span = Math.min(MAG_LIMIT, Math.max(-1.5, mag));
  return 0.55 + (MAG_LIMIT - span) * 0.32;
}

function offsetOut(point: Point, pad: number): Point {
  const length = Math.hypot(point.x, point.y);
  if (length < 1) {
    return { x: point.x, y: point.y - pad };
  }
  return {
    x: point.x + (point.x / length) * pad,
    y: point.y + (point.y / length) * pad,
  };
}

function svgElement<T extends SVGElement>(name: string): T {
  return document.createElementNS(SVG_NS, name) as T;
}

function addText(parent: SVGGElement, x: number, y: number, text: string, className: string): void {
  const node = svgElement<SVGTextElement>("text");
  node.setAttribute("class", className);
  node.setAttribute("x", (CENTER + x).toFixed(2));
  node.setAttribute("y", (CENTER + y).toFixed(2));
  node.setAttribute("text-anchor", "middle");
  node.setAttribute("dominant-baseline", "middle");
  node.setAttribute("data-upright", "1");
  node.textContent = text;
  parent.append(node);
}

function addDot(
  parent: SVGElement,
  point: Point,
  radius: number,
  className: string,
  fill: string,
): void {
  const node = svgElement<SVGCircleElement>("circle");
  node.setAttribute("class", className);
  node.setAttribute("cx", (CENTER + point.x).toFixed(2));
  node.setAttribute("cy", (CENTER + point.y).toFixed(2));
  node.setAttribute("r", radius.toFixed(2));
  node.setAttribute("fill", fill);
  parent.append(node);
}

type ChartStar = StarRecord & { azimuth: number; altitude: number };

function placeStars(date: Date, place: { latitude: number; longitude: number }, catalog: StarCatalog): ChartStar[] {
  const observer = new Observer(place.latitude, place.longitude, 0);
  const rotation = Rotation_EQJ_HOR(date, observer);
  return catalog.stars.map((star) => {
    const equatorial = VectorFromSphere(new Spherical(star.decDeg, normalizeDegrees(star.raHours * 15), 1), date);
    const horizontal = RotateVector(rotation, equatorial);
    const sphere = HorizonFromVector(horizontal, "normal");
    return {
      ...star,
      azimuth: normalizeDegrees(sphere.lon),
      altitude: sphere.lat,
    };
  });
}

export function createSkyMap(): {
  element: HTMLElement;
  update(model: SkyMapModel): void;
} {
  const section = document.createElement("section");
  section.className = "sky-map";
  section.id = "sky-map";

  const head = document.createElement("div");
  head.className = "sky-map-head";

  const title = document.createElement("h2");
  title.className = "card-title";
  title.id = "sky-map-title";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "sky-map-point";
  button.id = "sky-map-point";
  button.setAttribute("aria-pressed", "false");

  head.append(title, button);

  const note = document.createElement("p");
  note.id = "sky-map-note";
  note.className = "pending";

  const svg = svgElement<SVGSVGElement>("svg");
  svg.id = "sky-map-svg";
  svg.setAttribute("class", "sky-map-svg");
  svg.setAttribute("viewBox", `0 0 ${VIEW} ${VIEW}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("data-view-bearing", "0.0");

  const rot = svgElement<SVGGElement>("g");
  rot.id = "sky-map-rot";
  svg.append(rot);
  section.append(head, note, svg);

  let viewBearing = 0;
  let sensorOn = false;
  let sensorDenied = false;
  let locale: Locale = "ko";
  let place: SkyMapModel["place"] = null;
  let starStatus: SkyMapModel["starStatus"] = "loading";
  let activePointer: number | null = null;
  let lastX = 0;

  const paintBearing = () => {
    svg.setAttribute("data-view-bearing", formatBearing(viewBearing));
    rot.setAttribute("transform", `rotate(${(-viewBearing).toFixed(3)} ${CENTER} ${CENTER})`);
    for (const node of rot.querySelectorAll<SVGTextElement>("[data-upright]")) {
      const x = Number(node.getAttribute("x"));
      const y = Number(node.getAttribute("y"));
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      node.setAttribute("transform", `rotate(${viewBearing.toFixed(3)} ${x.toFixed(2)} ${y.toFixed(2)})`);
    }
  };

  const noteKey = (): MessageKey => {
    if (!place) {
      return "skyMapChoose";
    }
    if (sensorDenied) {
      return "skyMapSensorDenied";
    }
    if (sensorOn) {
      return "skyMapSensorOn";
    }
    if (starStatus === "error") {
      return "skyMapStarError";
    }
    if (starStatus === "loading") {
      return "skyMapStarLoading";
    }
    return "skyMapDrag";
  };

  const renderNote = () => {
    const key = noteKey();
    const kind = key === "skyMapSensorDenied" || key === "skyMapStarError" ? "alert" : "status";
    note.dataset.i18n = key;
    delete note.dataset.i18nValues;
    note.textContent = translate(locale, key);
    note.setAttribute("role", kind);
    if (kind === "alert") {
      note.removeAttribute("aria-live");
      return;
    }
    note.setAttribute("aria-live", "polite");
  };

  const renderCopy = () => {
    title.dataset.i18n = "skyMapTitle";
    title.textContent = translate(locale, "skyMapTitle");
    button.dataset.i18n = "skyMapPoint";
    button.textContent = translate(locale, "skyMapPoint");
    svg.setAttribute("aria-label", translate(locale, "skyMapAria"));
    renderNote();
  };

  const stopSensor = () => {
    sensorOn = false;
    button.setAttribute("aria-pressed", "false");
    window.removeEventListener("deviceorientation", onOrientation);
    window.removeEventListener("deviceorientationabsolute", onOrientation);
    renderNote();
  };

  const startSensor = () => {
    sensorOn = true;
    sensorDenied = false;
    button.setAttribute("aria-pressed", "true");
    window.addEventListener("deviceorientationabsolute", onOrientation);
    window.addEventListener("deviceorientation", onOrientation);
    renderNote();
  };

  function onOrientation(event: Event) {
    if (!section.isConnected) {
      stopSensor();
      return;
    }
    if (!sensorOn) {
      return;
    }
    const orientation = event as DeviceOrientationEvent & { webkitCompassHeading?: number };
    const heading = headingFromOrientation({
      alpha: typeof orientation.alpha === "number" ? orientation.alpha : null,
      absolute: orientation.absolute === true,
      webkitCompassHeading:
        typeof orientation.webkitCompassHeading === "number" ? orientation.webkitCompassHeading : null,
    });
    if (heading === null) {
      return;
    }
    viewBearing = heading;
    paintBearing();
  }

  const denySensor = () => {
    sensorDenied = true;
    sensorOn = false;
    button.setAttribute("aria-pressed", "false");
    renderNote();
  };

  button.addEventListener("click", () => {
    if (sensorOn) {
      sensorDenied = false;
      stopSensor();
      return;
    }
    const ctor = globalThis.DeviceOrientationEvent as
      | (typeof DeviceOrientationEvent & {
          requestPermission?: (enableCompass: boolean) => Promise<string>;
        })
      | undefined;
    if (typeof ctor !== "function") {
      denySensor();
      return;
    }
    if (typeof ctor.requestPermission !== "function") {
      startSensor();
      return;
    }
    // iOS는 생성자 메서드로 바로 불러야 권한 창이 뜬다. true는 나침반(webkitCompassHeading) 권한.
    let pending: Promise<string>;
    try {
      pending = ctor.requestPermission(true);
    } catch {
      denySensor();
      return;
    }
    void Promise.resolve(pending)
      .then((result) => {
        if (result === "granted") {
          startSensor();
          return;
        }
        denySensor();
      })
      .catch(() => {
        denySensor();
      });
  });

  svg.addEventListener("pointerdown", (event) => {
    activePointer = event.pointerId;
    lastX = event.clientX;
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      // jsdom에는 포인터 캡처가 없다.
    }
  });

  svg.addEventListener("pointermove", (event) => {
    if (activePointer !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - lastX;
    if (deltaX === 0) {
      return;
    }
    lastX = event.clientX;
    viewBearing = bearingAfterDrag(viewBearing, deltaX, svg.getBoundingClientRect().width);
    paintBearing();
  });

  const endDrag = (event: PointerEvent) => {
    if (activePointer === event.pointerId) {
      activePointer = null;
    }
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  const drawChart = (model: SkyMapModel) => {
    rot.replaceChildren();
    svg.replaceChildren(rot);
    if (!model.place || Number.isNaN(model.date.getTime())) {
      svg.setAttribute("hidden", "");
      return;
    }
    svg.removeAttribute("hidden");

    const rim = svgElement<SVGCircleElement>("circle");
    rim.setAttribute("cx", String(CENTER));
    rim.setAttribute("cy", String(CENTER));
    rim.setAttribute("r", String(RADIUS));
    rim.setAttribute("fill", "none");
    rim.setAttribute("stroke", RIM_STROKE);
    rim.setAttribute("stroke-width", "0.8");
    svg.insertBefore(rim, rot);

    const zenith = svgElement<SVGCircleElement>("circle");
    zenith.setAttribute("cx", String(CENTER));
    zenith.setAttribute("cy", String(CENTER));
    zenith.setAttribute("r", "1.1");
    zenith.setAttribute("fill", RIM_STROKE);
    svg.append(zenith);

    let placed: ChartStar[] = [];
    if (model.stars && model.starStatus === "ready") {
      try {
        placed = placeStars(model.date, model.place, model.stars);
      } catch {
        placed = [];
      }
    }
    const byHr = new Map(placed.map((star) => [star.hr, star]));
    if (model.stars) {
      for (const [from, to] of model.stars.lines) {
        const start = byHr.get(from);
        const end = byHr.get(to);
        if (!start || !end) {
          continue;
        }
        const startPoint = projectAllSky(start.azimuth, start.altitude, RADIUS);
        const endPoint = projectAllSky(end.azimuth, end.altitude, RADIUS);
        if (!startPoint || !endPoint) {
          continue;
        }
        const line = svgElement<SVGLineElement>("line");
        line.setAttribute("class", "sky-line");
        line.setAttribute("x1", (CENTER + startPoint.x).toFixed(2));
        line.setAttribute("y1", (CENTER + startPoint.y).toFixed(2));
        line.setAttribute("x2", (CENTER + endPoint.x).toFixed(2));
        line.setAttribute("y2", (CENTER + endPoint.y).toFixed(2));
        line.setAttribute("stroke", LINE_STROKE);
        line.setAttribute("stroke-width", "0.6");
        line.setAttribute("stroke-opacity", "0.75");
        rot.append(line);
      }
    }
    for (const star of placed) {
      const point = projectAllSky(star.azimuth, star.altitude, RADIUS);
      if (!point) {
        continue;
      }
      const dot = svgElement<SVGCircleElement>("circle");
      dot.setAttribute("class", "sky-star");
      dot.setAttribute("cx", (CENTER + point.x).toFixed(2));
      dot.setAttribute("cy", (CENTER + point.y).toFixed(2));
      dot.setAttribute("r", starRadius(star.mag).toFixed(2));
      dot.setAttribute("fill", STAR_FILL);
      dot.setAttribute("fill-opacity", Math.max(0.45, Math.min(1, (6.2 - star.mag) / 6.2)).toFixed(2));
      rot.append(dot);
    }

    const trackSegments: string[][] = [];
    let trackBatch: string[] = [];
    const trackMarks: Array<{ point: Point; label: string }> = [];
    const seenTimes = new Set<string>();
    const flushTrack = () => {
      if (trackBatch.length >= 2) {
        trackSegments.push(trackBatch);
      }
      trackBatch = [];
    };
    for (const sample of model.issTrack) {
      const point = projectAllSky(sample.azimuth, sample.elevation, RADIUS);
      if (!point) {
        flushTrack();
        continue;
      }
      trackBatch.push(`${(CENTER + point.x).toFixed(2)},${(CENTER + point.y).toFixed(2)}`);
      if (!sample.mark) {
        continue;
      }
      const label = formatKstTime(sample.time);
      if (seenTimes.has(label)) {
        continue;
      }
      seenTimes.add(label);
      trackMarks.push({ point, label });
    }
    flushTrack();
    for (const segment of trackSegments) {
      const path = svgElement<SVGPolylineElement>("polyline");
      path.setAttribute("class", "sky-iss");
      path.setAttribute("points", segment.join(" "));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", AMBER);
      path.setAttribute("stroke-width", "1.2");
      rot.append(path);
    }
    for (const mark of trackMarks) {
      addDot(rot, mark.point, 1.5, "sky-tick", AMBER);
      const labelPoint = offsetOut(mark.point, 7);
      addText(rot, labelPoint.x, labelPoint.y, mark.label, "sky-tick-label");
    }

    const observer = new Observer(model.place.latitude, model.place.longitude, 0);
    for (const body of CHART_BODIES) {
      const equatorial = Equator(body.body, model.date, observer, true, true);
      const horizontal = Horizon(model.date, observer, equatorial.ra, equatorial.dec, "normal");
      const point = projectAllSky(horizontal.azimuth, horizontal.altitude, RADIUS);
      if (!point) {
        continue;
      }
      addDot(rot, point, 2.4, `sky-planet sky-planet-${body.id}`, AMBER);
      const key = planetNameKey(body.id);
      const labelPoint = offsetOut(point, 6);
      addText(rot, labelPoint.x, labelPoint.y, key ? translate(model.locale, key) : body.id, "sky-planet-label");
    }
    const moonEquator = Equator(Body.Moon, model.date, observer, true, true);
    const moon = Horizon(model.date, observer, moonEquator.ra, moonEquator.dec, "normal");
    const moonPoint = projectAllSky(moon.azimuth, moon.altitude, RADIUS);
    if (moonPoint) {
      addDot(rot, moonPoint, 3.2, "sky-moon", STAR_FILL);
      const labelPoint = offsetOut(moonPoint, 7);
      addText(rot, labelPoint.x, labelPoint.y, translate(model.locale, "moon"), "sky-moon-label");
    }

    for (const cardinal of CARDINALS) {
      const point = projectAllSky(cardinal.azimuth, 8, RADIUS);
      if (!point) {
        continue;
      }
      addText(rot, point.x, point.y, translate(model.locale, cardinal.key), "sky-cardinal");
    }
    paintBearing();
  };

  return {
    element: section,
    update(model) {
      locale = model.locale;
      place = model.place;
      starStatus = model.starStatus;
      renderCopy();
      try {
        drawChart(model);
      } catch {
        rot.replaceChildren();
        if (model.place) {
          svg.removeAttribute("hidden");
        } else {
          svg.setAttribute("hidden", "");
        }
        note.dataset.i18n = "tonightCalcError";
        note.textContent = translate(locale, "tonightCalcError");
        note.setAttribute("role", "alert");
        note.removeAttribute("aria-live");
      }
    },
  };
}
