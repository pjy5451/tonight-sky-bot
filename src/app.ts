import {
  FILTER_GROUPS,
  countryMessageKey,
  defaultGlobeFilter,
  groupMessageKey,
  isFilterGroup,
  isSatelliteShown,
  toggleFilterGroup,
  toggleKoreaOnly,
  type GlobeFilter,
} from "./catalog";
import { canRenderGlobe, mountSatelliteGlobe, type SatelliteGlobe } from "./globe-view";
import { exclusiveHighlight } from "./globe-style";
import {
  meteorNameKey,
  planetNameKey,
  regionNameKey,
  regionShortKey,
  resolveLanguage,
  saveLanguage,
  translate,
  type Locale,
  type MessageKey,
} from "./i18n";
import {
  REGIONS,
  loadLocation,
  saveLocation,
  type LocationInput,
  type StoredLocation,
} from "./location";
import {
  ISS_NORAD_CATALOG_ID,
  ORBIT_REFRESH_MS,
  POSITION_UPDATE_MS,
  SCENE_BATCH,
  buildSatelliteScene,
  findNextKoreaPass,
  orbitPathsForStation,
  formatAltitude,
  formatGroundPosition,
  formatKoreaPassLabel,
  formatSpeed,
  parseCatalogDocument,
  parseTleDocument,
  type CatalogLoad,
  type Overflight,
  type SatellitePoint,
  type Station,
  type StationCatalog,
} from "./satellites";
import {
  COUNTDOWN_UPDATE_MS,
  countdownParts,
  formatCountdownUnit,
  formatLaunchDateTime,
  formatLaunchDday,
  kstCalendarDayIndex,
  launchOperatorPlace,
  launchVehicle,
  nextLaunchTitle,
  parseLaunchDocument,
  upcomingLaunches,
  type CountdownParts,
  type LaunchCatalog,
  type LaunchItem,
} from "./launches";
import {
  ISS_PASS_HORIZON_MS,
  ISS_PASS_LOOKBACK_MS,
  issPassLater,
  issPassRoute,
  issPassTimeRange,
  kstDayOffset,
  predictStationPasses,
  sampleIssTrack,
  upcomingIssPasses,
  type IssPass,
} from "./iss-passes";
import { createSkyMap, parseStarCatalog, type StarCatalog } from "./sky-map";
import { formatMeteorDday, nextMeteorShower } from "./meteors";
import { dataSourceFooter, staleDataNotice } from "./sources";
import {
  computeTonightSky,
  directionSkyLabel,
  formatKstTime,
  moonLitPath,
  moonPhaseName,
  type TonightSky,
} from "./sky";

type TabId = "tonight" | "satellites" | "launches";

type Tab = {
  id: TabId;
  labelKey: MessageKey;
};

const BRAND_NAME = "Argonova";

let locale: Locale = "ko";
const skyMaps = new WeakMap<HTMLElement, ReturnType<typeof createSkyMap>>();
let starCatalog: StarCatalog | null = null;
let starStatus: "loading" | "ready" | "error" = "loading";
let starGeneration = 0;

function tr(key: MessageKey, values?: Record<string, string | number>): string {
  return translate(locale, key, values);
}

function bindText(element: HTMLElement, key: MessageKey, values?: Record<string, string | number>): void {
  element.dataset.i18n = key;
  if (values) {
    element.dataset.i18nValues = JSON.stringify(values);
  } else {
    delete element.dataset.i18nValues;
  }
  element.textContent = tr(key, values);
}

function bindAria(element: HTMLElement, key: MessageKey): void {
  element.dataset.i18nAria = key;
  element.setAttribute("aria-label", tr(key));
}

function readBoundValues(raw: string | undefined): Record<string, string | number> | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, string | number>;
  } catch {
    return undefined;
  }
}

function applyBoundCopy(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    if (!key) {
      return;
    }
    element.textContent = translate(locale, key as MessageKey, readBoundValues(element.dataset.i18nValues));
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((element) => {
    const key = element.dataset.i18nAria;
    if (key) {
      element.setAttribute("aria-label", translate(locale, key as MessageKey));
    }
  });
}

function markLanguageButton(button: HTMLElement): void {
  button.querySelectorAll<HTMLElement>("[data-lang]").forEach((code) => {
    code.classList.toggle("is-current", code.dataset.lang === locale);
  });
}

type LocalJson = { ok: true; payload: unknown } | { ok: false; payload: null };

function createLocalJsonReader(): (fileName: string) => Promise<LocalJson> {
  const pending = new Map<string, Promise<LocalJson>>();
  return (fileName: string) => {
    const existing = pending.get(fileName);
    if (existing) {
      return existing;
    }
    const request = Promise.resolve()
      .then(() => fetch(`${import.meta.env.BASE_URL}data/${fileName}`))
      .then(async (response) => {
        if (!response.ok) {
          return { ok: false as const, payload: null };
        }
        return { ok: true as const, payload: await response.json() };
      })
      .catch(() => ({ ok: false as const, payload: null }));
    pending.set(fileName, request);
    return request;
  };
}

function setLiveRole(element: HTMLElement, kind: "status" | "alert"): void {
  element.setAttribute("role", kind);
  if (kind === "alert") {
    element.removeAttribute("aria-live");
    return;
  }
  element.setAttribute("aria-live", "polite");
}

const tabs: Tab[] = [
  { id: "tonight", labelKey: "tabTonight" },
  { id: "satellites", labelKey: "tabSatellites" },
  { id: "launches", labelKey: "tabLaunches" },
];

/** DESIGN.md 5-1: 1024px 이상이면 PC 대시보드, 미만이면 폰 탭. */
const DESKTOP_MIN_WIDTH = 1024;

function isDesktopViewport(): boolean {
  return window.innerWidth >= DESKTOP_MIN_WIDTH;
}

const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 60_000,
};

function createSvg(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  return svg;
}

function createTabIcon(tabId: TabId): SVGSVGElement {
  const svg = createSvg();
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");

  const addPath = (d: string) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  };

  if (tabId === "tonight") {
    addPath("M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z");
    return svg;
  }

  if (tabId === "satellites") {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "9");
    svg.append(circle);
    addPath("M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18");
    return svg;
  }

  addPath("M12 2c3 3 4.5 7 4 12H8c-.5-5 1-9 4-12z");
  addPath("M8 14l-3 4h4M16 14l3 4h-4M10 18l2 4 2-4");
  return svg;
}

function createBrandIcon(): SVGSVGElement {
  const svg = createSvg();
  svg.setAttribute("width", "26");
  svg.setAttribute("height", "26");
  svg.setAttribute("stroke", "#E8B04A");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z");
  svg.append(path);
  return svg;
}

function createPinIcon(): SVGSVGElement {
  const svg = createSvg();
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("stroke", "#E8B04A");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z");

  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "10");
  circle.setAttribute("r", "2.5");

  svg.append(path, circle);
  return svg;
}

function createPanel(tab: Tab): HTMLElement {
  const panel = document.createElement("section");
  panel.id = `panel-${tab.id}`;
  panel.className = "panel";
  panel.role = "tabpanel";
  panel.setAttribute("aria-labelledby", `tab-${tab.id}`);
  return panel;
}

function createCard(className: string): HTMLElement {
  const card = document.createElement("article");
  card.className = className;
  return card;
}

function createCardTitle(text: string): HTMLHeadingElement {
  const title = document.createElement("h2");
  title.className = "card-title";
  title.textContent = text;
  return title;
}

function createBoundTitle(key: MessageKey): HTMLHeadingElement {
  const title = createCardTitle("");
  bindText(title, key);
  return title;
}

function createTimeStat(id: string, labelKey: MessageKey): HTMLElement {
  const card = createCard("stat-card");
  const labelElement = document.createElement("span");
  labelElement.className = "stat-label";
  bindText(labelElement, labelKey);

  const value = document.createElement("span");
  value.id = id;
  value.className = "stat-value";
  value.textContent = "—";

  card.append(labelElement, value);
  return card;
}

function setClockValue(element: HTMLElement, date: Date | null, emptyLabel: string): void {
  if (date) {
    element.textContent = formatKstTime(date);
    element.classList.remove("is-note");
    return;
  }

  element.textContent = emptyLabel;
  element.classList.toggle("is-note", emptyLabel !== "—");
}

function renderMoonIcon(phaseAngle: number, latitude: number): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("aria-hidden", "true");

  const disk = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  disk.setAttribute("cx", "10");
  disk.setAttribute("cy", "10");
  disk.setAttribute("r", "9");
  disk.setAttribute("fill", "#1C2333");
  svg.append(disk);

  const lit = moonLitPath(phaseAngle, latitude < 0);
  if (lit) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", lit);
    path.setAttribute("fill", "#E9EDF5");
    svg.append(path);
  }

  return svg;
}

function renderPlanetRows(list: HTMLElement, planets: TonightSky["planets"]): void {
  list.replaceChildren();
  for (const planet of planets) {
    const row = document.createElement("div");
    row.className = "planet-row";

    const dot = document.createElement("span");
    dot.className = `planet-dot planet-dot-${planet.id}`;
    dot.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "planet-name";
    const planetKey = planetNameKey(planet.id);
    name.textContent = planetKey ? tr(planetKey) : planet.name;

    const detail = document.createElement("span");
    detail.className = "planet-detail";
    detail.textContent = directionSkyLabel(planet.direction, locale);

    row.append(dot, name, detail);
    list.append(row);
  }
}

function fillMeteorShower(panel: HTMLElement, date: Date): void {
  const name = panel.querySelector("#meteor-name");
  const dday = panel.querySelector("#meteor-dday");
  if (!(name instanceof HTMLElement) || !(dday instanceof HTMLElement)) {
    return;
  }
  const next = nextMeteorShower(date);
  const meteorKey = meteorNameKey(next.shower.id);
  name.textContent = meteorKey ? tr("meteorPeak", { name: tr(meteorKey) }) : next.shower.name;
  dday.textContent = formatMeteorDday(next.daysUntil);
}

function setTonightStatus(panel: HTMLElement, message: string | null): void {
  const status = panel.querySelector("#tonight-status");
  if (!(status instanceof HTMLElement)) {
    return;
  }
  if (!message) {
    status.hidden = true;
    status.textContent = "";
    setLiveRole(status, "status");
    return;
  }
  status.hidden = false;
  status.textContent = message;
  setLiveRole(status, "alert");
}

function clearTonightNumbers(panel: HTMLElement): void {
  const sunset = panel.querySelector("#sunset-value");
  const sunrise = panel.querySelector("#sunrise-value");
  const moonValue = panel.querySelector("#moon-value");
  const moonIcon = panel.querySelector("#moon-icon");
  const moonName = panel.querySelector("#moon-phase-name");
  const planetList = panel.querySelector("#planet-list");
  const planetEmpty = panel.querySelector("#planet-empty");
  if (sunset instanceof HTMLElement) {
    setClockValue(sunset, null, "—");
  }
  if (sunrise instanceof HTMLElement) {
    setClockValue(sunrise, null, "—");
  }
  if (moonValue instanceof HTMLElement) {
    moonValue.textContent = "—";
    moonValue.classList.remove("is-note");
  }
  if (moonIcon instanceof HTMLElement) {
    moonIcon.replaceChildren();
  }
  if (moonName instanceof HTMLElement) {
    moonName.textContent = "";
  }
  if (planetList instanceof HTMLElement) {
    planetList.replaceChildren();
  }
  if (planetEmpty instanceof HTMLElement) {
    planetEmpty.hidden = true;
    planetEmpty.textContent = "";
  }
}

type IssOrbitState = "loading" | "ready" | "error" | "missing";

type IssOrbitLoad = {
  state: IssOrbitState;
  station: Station | null;
  cacheKey: string;
  cache: IssPass[];
};

function passDayLabel(offset: number): string {
  if (offset <= 0) {
    return tr("dayToday");
  }
  if (offset === 1) {
    return tr("dayTomorrow");
  }
  if (offset === 2) {
    return tr("dayAfter");
  }
  return tr("dayLater", { days: offset });
}

function setIssNote(note: HTMLElement, message: string | null, kind: "status" | "alert"): void {
  delete note.dataset.i18n;
  delete note.dataset.i18nValues;
  if (!message) {
    note.hidden = true;
    note.textContent = "";
    return;
  }
  note.hidden = false;
  note.textContent = message;
  setLiveRole(note, kind);
}

function hideIssPassDetails(panel: HTMLElement): void {
  const badge = panel.querySelector("#iss-pass-badge");
  const main = panel.querySelector("#iss-pass-main");
  const when = panel.querySelector("#iss-pass-when");
  const time = panel.querySelector("#iss-pass-time");
  const detail = panel.querySelector("#iss-pass-detail");
  const divider = panel.querySelector("#iss-pass-divider");
  const list = panel.querySelector("#iss-pass-list");
  if (badge instanceof HTMLElement) {
    badge.hidden = true;
  }
  if (main instanceof HTMLElement) {
    main.hidden = true;
  }
  if (when instanceof HTMLElement) {
    when.hidden = true;
    when.textContent = "";
  }
  if (time instanceof HTMLElement) {
    time.textContent = "";
  }
  if (detail instanceof HTMLElement) {
    detail.textContent = "";
  }
  if (divider instanceof HTMLElement) {
    divider.hidden = true;
  }
  if (list instanceof HTMLElement) {
    list.replaceChildren();
  }
}

function renderIssPassCard(panel: HTMLElement, date: Date, issLoad: IssOrbitLoad): void {
  const note = panel.querySelector("#iss-pass-note");
  const badge = panel.querySelector("#iss-pass-badge");
  const main = panel.querySelector("#iss-pass-main");
  const when = panel.querySelector("#iss-pass-when");
  const time = panel.querySelector("#iss-pass-time");
  const detail = panel.querySelector("#iss-pass-detail");
  const divider = panel.querySelector("#iss-pass-divider");
  const list = panel.querySelector("#iss-pass-list");
  if (
    !(note instanceof HTMLElement) ||
    !(badge instanceof HTMLElement) ||
    !(main instanceof HTMLElement) ||
    !(when instanceof HTMLElement) ||
    !(time instanceof HTMLElement) ||
    !(detail instanceof HTMLElement) ||
    !(divider instanceof HTMLElement) ||
    !(list instanceof HTMLElement)
  ) {
    return;
  }

  if (Number.isNaN(date.getTime())) {
    hideIssPassDetails(panel);
    setIssNote(note, null, "status");
    return;
  }

  const location = loadLocation(localStorage);
  if (!location) {
    hideIssPassDetails(panel);
    setIssNote(note, tr("issPassChoose"), "status");
    return;
  }

  if (issLoad.state === "loading") {
    hideIssPassDetails(panel);
    setIssNote(note, tr("orbitLoading"), "status");
    return;
  }
  if (issLoad.state === "error" || !issLoad.station) {
    hideIssPassDetails(panel);
    setIssNote(note, tr(issLoad.state === "missing" ? "issMissing" : "orbitLoadError"), "alert");
    return;
  }

  const cacheKey = [
    issLoad.station.noradId,
    issLoad.station.omm.EPOCH,
    issLoad.station.omm.MEAN_ANOMALY,
    location.latitude,
    location.longitude,
    Math.floor(date.getTime() / 60_000),
  ].join("|");

  let passes = issLoad.cache;
  if (cacheKey !== issLoad.cacheKey) {
    const predicted = predictStationPasses(
      issLoad.station,
      { latitude: location.latitude, longitude: location.longitude, heightMeters: 0 },
      new Date(date.getTime() - ISS_PASS_LOOKBACK_MS),
      new Date(date.getTime() + ISS_PASS_HORIZON_MS),
    );
    if (!predicted) {
      hideIssPassDetails(panel);
      setIssNote(note, tr("issPassFailed"), "alert");
      return;
    }
    passes = upcomingIssPasses(predicted, date);
    issLoad.cacheKey = cacheKey;
    issLoad.cache = passes;
  }

  const featured = passes[0];
  if (!featured) {
    hideIssPassDetails(panel);
    setIssNote(note, tr("issPassNone"), "status");
    return;
  }

  badge.hidden = false;
  main.hidden = false;
  setIssNote(note, null, "status");
  const offset = kstDayOffset(date, featured.start.time);
  if (offset > 0) {
    when.hidden = false;
    when.textContent = passDayLabel(offset);
  } else {
    when.hidden = true;
    when.textContent = "";
  }
  time.textContent = issPassTimeRange(featured);
  detail.textContent = issPassRoute(featured, locale);

  list.replaceChildren();
  for (const pass of passes.slice(1)) {
    const row = document.createElement("div");
    row.className = "iss-pass-row";
    const label = document.createElement("span");
    label.className = "iss-pass-row-label";
    label.textContent = passDayLabel(kstDayOffset(date, pass.start.time));
    const value = document.createElement("span");
    value.className = "iss-pass-row-value";
    value.textContent = issPassLater(pass, locale);
    row.append(label, value);
    list.append(row);
  }
  divider.hidden = passes.length < 2;
}

function skyIssTrack(
  date: Date,
  issLoad: IssOrbitLoad,
  place: { latitude: number; longitude: number } | null,
) {
  if (!place || issLoad.state !== "ready" || !issLoad.station) {
    return [];
  }
  const pass = issLoad.cache.find(
    (item) => kstDayOffset(date, item.start.time) <= 0 && item.end.time.getTime() >= date.getTime(),
  );
  if (!pass) {
    return [];
  }
  return sampleIssTrack(
    issLoad.station,
    { latitude: place.latitude, longitude: place.longitude, heightMeters: 0 },
    pass,
    15_000,
  );
}

function fillTonightPanel(panel: HTMLElement, date: Date, issLoad: IssOrbitLoad): void {
  renderIssPassCard(panel, date, issLoad);
  const locationForMap = loadLocation(localStorage);
  skyMaps.get(panel)?.update({
    locale,
    place: locationForMap
      ? { latitude: locationForMap.latitude, longitude: locationForMap.longitude }
      : null,
    date,
    stars: starCatalog,
    starStatus,
    issTrack: skyIssTrack(date, issLoad, locationForMap),
  });
  try {
    fillMeteorShower(panel, date);
  } catch {
    const name = panel.querySelector("#meteor-name");
    const dday = panel.querySelector("#meteor-dday");
    if (name instanceof HTMLElement) {
      name.textContent = "—";
    }
    if (dday instanceof HTMLElement) {
      dday.textContent = "—";
    }
    clearTonightNumbers(panel);
    setTonightStatus(panel, tr("tonightCalcError"));
    return;
  }

  const sunset = panel.querySelector("#sunset-value");
  const sunrise = panel.querySelector("#sunrise-value");
  const moonValue = panel.querySelector("#moon-value");
  const moonIcon = panel.querySelector("#moon-icon");
  const moonName = panel.querySelector("#moon-phase-name");
  const planetList = panel.querySelector("#planet-list");
  const planetEmpty = panel.querySelector("#planet-empty");
  if (
    !(sunset instanceof HTMLElement) ||
    !(sunrise instanceof HTMLElement) ||
    !(moonValue instanceof HTMLElement) ||
    !(moonIcon instanceof HTMLElement) ||
    !(moonName instanceof HTMLElement) ||
    !(planetList instanceof HTMLElement) ||
    !(planetEmpty instanceof HTMLElement)
  ) {
    return;
  }

  const location = loadLocation(localStorage);
  if (!location) {
    setClockValue(sunset, null, "—");
    setClockValue(sunrise, null, "—");
    moonValue.textContent = "—";
    moonValue.classList.remove("is-note");
    moonIcon.replaceChildren();
    moonName.textContent = "";
    planetList.replaceChildren();
    planetEmpty.hidden = false;
    planetEmpty.textContent = tr("chooseLocationSky");
    setTonightStatus(panel, null);
    return;
  }

  try {
    const sky = computeTonightSky(location, date);
    setClockValue(sunset, sky.sunset, tr("noSet"));
    setClockValue(sunrise, sky.sunrise, tr("noRise"));
    moonValue.textContent = `${sky.moonIlluminationPercent}%`;
    moonValue.classList.remove("is-note");
    moonIcon.replaceChildren(renderMoonIcon(sky.moonPhaseAngle, location.latitude));
    moonName.textContent = moonPhaseName(sky.moonPhaseAngle, sky.moonIlluminationPercent, locale);
    renderPlanetRows(planetList, sky.planets);
    planetEmpty.hidden = sky.planets.length > 0;
    planetEmpty.textContent = sky.planets.length > 0 ? "" : tr("noPlanets");
    setTonightStatus(panel, null);
  } catch {
    clearTonightNumbers(panel);
    setTonightStatus(panel, tr("tonightCalcError"));
  }
}

function createTonightPanel(tab: Tab): HTMLElement {
  const panel = createPanel(tab);

  const status = document.createElement("p");
  status.id = "tonight-status";
  status.className = "pending";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;

  const stats = document.createElement("div");
  stats.className = "stat-grid";

  const moon = createCard("stat-card");
  const moonLabel = document.createElement("span");
  moonLabel.className = "stat-label";
  bindText(moonLabel, "moon");

  const moonRow = document.createElement("div");
  moonRow.className = "moon-readout";

  const moonIcon = document.createElement("span");
  moonIcon.id = "moon-icon";
  moonIcon.className = "moon-icon";

  const moonValue = document.createElement("span");
  moonValue.id = "moon-value";
  moonValue.className = "stat-value";
  moonValue.textContent = "—";

  moonRow.append(moonIcon, moonValue);

  const moonName = document.createElement("span");
  moonName.id = "moon-phase-name";
  moonName.className = "moon-phase-name";
  moon.append(moonLabel, moonRow, moonName);

  stats.append(
    createTimeStat("sunset-value", "sunset"),
    createTimeStat("sunrise-value", "sunrise"),
    moon,
  );

  const iss = createCard("card card-highlight");
  iss.id = "iss-pass-card";

  const issHead = document.createElement("div");
  issHead.className = "iss-pass-head";
  const issBadge = document.createElement("span");
  issBadge.id = "iss-pass-badge";
  issBadge.className = "iss-badge";
  issBadge.hidden = true;
  bindText(issBadge, "issNakedEye");
  issHead.append(createBoundTitle("issPass"), issBadge);

  const issMain = document.createElement("div");
  issMain.id = "iss-pass-main";
  issMain.className = "iss-pass-main";
  issMain.hidden = true;

  const issWhen = document.createElement("span");
  issWhen.id = "iss-pass-when";
  issWhen.className = "iss-pass-when";
  issWhen.hidden = true;

  const issTime = document.createElement("span");
  issTime.id = "iss-pass-time";
  issTime.className = "iss-pass-time";

  const issDetail = document.createElement("span");
  issDetail.id = "iss-pass-detail";
  issDetail.className = "iss-pass-detail";
  issMain.append(issWhen, issTime, issDetail);

  const issDivider = document.createElement("div");
  issDivider.id = "iss-pass-divider";
  issDivider.className = "iss-pass-divider";
  issDivider.hidden = true;
  issDivider.setAttribute("aria-hidden", "true");

  const issList = document.createElement("div");
  issList.id = "iss-pass-list";
  issList.className = "iss-pass-list";

  const issNote = document.createElement("p");
  issNote.id = "iss-pass-note";
  issNote.className = "pending";
  issNote.setAttribute("role", "status");
  issNote.setAttribute("aria-live", "polite");
  bindText(issNote, "issPassChoose");

  iss.append(issHead, issMain, issDivider, issList, issNote);

  const planets = createCard("card");
  planets.append(createBoundTitle("planetsTitle"));

  const planetList = document.createElement("div");
  planetList.id = "planet-list";
  planetList.className = "planet-list";

  const planetEmpty = document.createElement("p");
  planetEmpty.id = "planet-empty";
  planetEmpty.className = "pending";
  planetEmpty.setAttribute("role", "status");
  planetEmpty.setAttribute("aria-live", "polite");
  bindText(planetEmpty, "chooseLocationSky");
  planets.append(planetList, planetEmpty);

  const skyMap = createSkyMap();
  skyMaps.set(panel, skyMap);

  const meteor = createCard("card card-row");
  const meteorCopy = document.createElement("div");
  meteorCopy.className = "card-copy";
  const meteorLabel = document.createElement("span");
  meteorLabel.className = "stat-label";
  bindText(meteorLabel, "nextMeteor");
  const meteorName = createCardTitle("—");
  meteorName.id = "meteor-name";
  meteorCopy.append(meteorLabel, meteorName);
  const meteorDday = document.createElement("span");
  meteorDday.id = "meteor-dday";
  meteorDday.className = "meteor-dday";
  meteorDday.textContent = "—";
  meteor.append(meteorCopy, meteorDday);

  const board = document.createElement("div");
  board.className = "board";
  board.append(skyMap.element, stats, iss, planets, meteor);

  panel.append(status, board);
  return panel;
}

function createLegendItem(className: string, label: string): HTMLElement {
  const item = document.createElement("span");
  item.className = "legend-item";

  const dot = document.createElement("span");
  dot.className = `legend-dot ${className}`;
  dot.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.textContent = label;

  item.append(dot, text);
  return item;
}

function createIssStat(id: string, labelKey: MessageKey, valueClass: string): HTMLElement {
  const cell = document.createElement("div");
  cell.className = "iss-stat";

  const labelElement = document.createElement("span");
  labelElement.className = "stat-label";
  bindText(labelElement, labelKey);

  const value = document.createElement("span");
  value.id = id;
  value.className = valueClass;
  value.textContent = "—";

  cell.append(labelElement, value);
  return cell;
}

function createSatellitesPanel(tab: Tab): HTMLElement {
  const panel = createPanel(tab);

  const desktopHead = document.createElement("div");
  desktopHead.className = "globe-desktop-head";

  const desktopCopy = document.createElement("div");
  desktopCopy.className = "globe-desktop-copy";

  const desktopTitle = document.createElement("h2");
  desktopTitle.className = "card-title";
  bindText(desktopTitle, "desktopGlobeTitle");

  const desktopNote = document.createElement("p");
  desktopNote.className = "globe-desktop-note";
  bindText(desktopNote, "desktopGlobeNote", { seconds: POSITION_UPDATE_MS / 1000 });

  desktopCopy.append(desktopTitle, desktopNote);
  desktopHead.append(desktopCopy);

  const stage = document.createElement("div");
  stage.className = "globe-stage";

  const mount = document.createElement("div");
  mount.id = "globe-mount";
  mount.className = "globe-mount";
  mount.setAttribute("role", "img");
  bindAria(mount, "globeAria");

  const globeStatus = document.createElement("p");
  globeStatus.id = "globe-status";
  globeStatus.className = "globe-status pending";
  globeStatus.setAttribute("role", "status");
  globeStatus.setAttribute("aria-live", "polite");
  globeStatus.textContent = tr("orbitLoading");

  const hud = document.createElement("div");
  hud.className = "globe-hud";

  stage.append(mount, globeStatus, hud);

  const legend = document.createElement("div");
  legend.className = "legend";
  const otherLegend = createLegendItem("legend-dot-other", "");
  const otherLegendText = otherLegend.querySelector("span:last-child");
  if (otherLegendText instanceof HTMLElement) {
    bindText(otherLegendText, "legendOther");
  }
  legend.append(createLegendItem("legend-dot-iss", "ISS"), otherLegend);

  const filters = document.createElement("div");
  filters.className = "sat-filters";
  filters.setAttribute("role", "group");
  bindAria(filters, "satFiltersAria");
  for (const group of FILTER_GROUPS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sat-filter";
    button.dataset.group = group;
    button.setAttribute("aria-pressed", "true");
    const swatch = document.createElement("span");
    swatch.className = `sat-swatch sat-swatch-${group}`;
    swatch.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    bindText(label, groupMessageKey(group));
    button.append(swatch, label);
    filters.append(button);
  }
  const koreaOnly = document.createElement("button");
  koreaOnly.type = "button";
  koreaOnly.className = "sat-filter";
  koreaOnly.dataset.filter = "korea-only";
  koreaOnly.setAttribute("aria-pressed", "false");
  const koreaLabel = document.createElement("span");
  bindText(koreaLabel, "filterKoreaOnly");
  koreaOnly.append(koreaLabel);
  filters.append(koreaOnly);

  const detail = createCard("card");
  detail.id = "sat-detail";
  const detailTitle = document.createElement("h2");
  detailTitle.id = "sat-detail-name";
  detailTitle.className = "card-title";
  detailTitle.textContent = tr("satDetailHint");
  const detailStats = document.createElement("div");
  detailStats.className = "iss-stats";
  detailStats.append(
    createIssStat("sat-detail-kind", "satKind", "iss-place"),
    createIssStat("sat-detail-country", "satCountry", "iss-place"),
    createIssStat("sat-detail-altitude", "altitude", "iss-metric"),
  );
  detail.append(detailTitle, detailStats);
  hud.append(detail);

  const catalogStatus = document.createElement("p");
  catalogStatus.id = "catalog-status";
  catalogStatus.className = "catalog-status";
  catalogStatus.hidden = true;
  catalogStatus.setAttribute("role", "status");

  const iss = createCard("card card-highlight");
  iss.id = "iss-card";
  const head = document.createElement("div");
  head.className = "iss-head";
  const live = document.createElement("span");
  live.id = "iss-status";
  live.className = "iss-now";
  head.append(createBoundTitle("issTitle"), live);

  const stats = document.createElement("div");
  stats.className = "iss-stats";
  stats.append(
    createIssStat("iss-place", "place", "iss-place"),
    createIssStat("iss-altitude", "altitude", "iss-metric"),
    createIssStat("iss-speed", "speed", "iss-metric"),
  );

  const pass = document.createElement("p");
  pass.id = "iss-pass";
  pass.className = "iss-pass";
  pass.setAttribute("role", "status");
  pass.setAttribute("aria-live", "polite");
  pass.textContent = tr("orbitLoading");

  iss.append(head, stats, pass);
  hud.append(iss);

  const source = document.createElement("p");
  source.id = "orbit-source";
  source.className = "orbit-source";
  source.textContent = tr("orbitSource");

  panel.append(desktopHead, stage, legend, filters, catalogStatus, source);
  panel.setAttribute("aria-busy", "true");
  return panel;
}

type SatelliteBinding = {
  show(): void;
  hide(): void;
  refresh(): void;
};

function bindSatellites(
  panel: HTMLElement,
  now: () => Date,
  readJson: (fileName: string) => Promise<LocalJson>,
): SatelliteBinding {
  const place = panel.querySelector("#iss-place");
  const altitude = panel.querySelector("#iss-altitude");
  const speed = panel.querySelector("#iss-speed");
  const pass = panel.querySelector("#iss-pass");
  const live = panel.querySelector("#iss-status");
  const globeStatus = panel.querySelector("#globe-status");
  const source = panel.querySelector("#orbit-source");
  const mount = panel.querySelector("#globe-mount");
  const detailTitle = panel.querySelector("#sat-detail-name");
  const detailKind = panel.querySelector("#sat-detail-kind");
  const detailCountry = panel.querySelector("#sat-detail-country");
  const detailAltitude = panel.querySelector("#sat-detail-altitude");
  const catalogStatus = panel.querySelector("#catalog-status");

  if (
    !(place instanceof HTMLElement) ||
    !(altitude instanceof HTMLElement) ||
    !(speed instanceof HTMLElement) ||
    !(pass instanceof HTMLElement) ||
    !(live instanceof HTMLElement) ||
    !(globeStatus instanceof HTMLElement) ||
    !(source instanceof HTMLElement) ||
    !(mount instanceof HTMLElement) ||
    !(detailTitle instanceof HTMLElement) ||
    !(detailKind instanceof HTMLElement) ||
    !(detailCountry instanceof HTMLElement) ||
    !(detailAltitude instanceof HTMLElement) ||
    !(catalogStatus instanceof HTMLElement)
  ) {
    return { show() {}, hide() {}, refresh() {} };
  }

  let catalog: StationCatalog | null = null;
  let extraLoad: CatalogLoad | null = null;
  let extras: Station[] = [];
  let filter: GlobeFilter = defaultGlobeFilter();
  let globe: SatelliteGlobe | null = null;
  let globeFailed = false;
  let globeStarting = false;
  let started = false;
  let passResult: Overflight | null = null;
  let passStamp = 0;
  let timer = 0;
  let aimedAtIss = false;
  let selectedId: number | null = null;
  let latestPoints: SatellitePoint[] = [];
  let sceneToken = 0;

  const publishGlobeStatus = () => {
    if (catalog?.error) {
      globeStatus.textContent = tr("orbitLoadError");
      setLiveRole(globeStatus, "alert");
      return;
    }
    if (globeFailed) {
      globeStatus.textContent = tr("globeUnavailable");
      setLiveRole(globeStatus, "status");
      return;
    }
    if (!catalog) {
      globeStatus.textContent = tr("orbitLoading");
      setLiveRole(globeStatus, "status");
      return;
    }
    globeStatus.textContent = "";
    setLiveRole(globeStatus, "status");
  };

  const setPassMessage = (message: string, kind: "status" | "alert") => {
    pass.textContent = message;
    setLiveRole(pass, kind);
  };

  const renderSource = () => {
    if (!catalog?.fetchedAt) {
      source.textContent = tr("orbitSource");
      return;
    }
    const fetched = new Date(catalog.fetchedAt);
    if (Number.isNaN(fetched.getTime())) {
      source.textContent = tr("orbitSource");
      return;
    }
    source.textContent = tr("orbitSourceUpdated", { time: formatKstTime(fetched) });
  };

  const renderCard = (sceneIss: ReturnType<typeof buildSatelliteScene>["iss"]) => {
    if (!catalog) {
      place.textContent = "—";
      altitude.textContent = "—";
      speed.textContent = "—";
      live.textContent = "";
      setPassMessage(tr("orbitLoading"), "status");
      return;
    }

    if (catalog.error) {
      place.textContent = "—";
      altitude.textContent = "—";
      speed.textContent = "—";
      live.textContent = "";
      setPassMessage(tr("orbitLoadError"), "alert");
      return;
    }

    if (!sceneIss) {
      place.textContent = "—";
      altitude.textContent = "—";
      speed.textContent = "—";
      live.textContent = "";
      setPassMessage(tr("issMissing"), "alert");
      return;
    }

    place.textContent = formatGroundPosition(sceneIss.fix.lat, sceneIss.fix.lng);
    altitude.textContent = formatAltitude(sceneIss.fix.altKm, locale);
    speed.textContent = formatSpeed(sceneIss.fix.speedKmh);
    live.textContent = tr("issNow");
    setPassMessage(
      passResult
        ? formatKoreaPassLabel(passResult, now(), locale)
        : tr("koreaPassFailed"),
      passResult ? "status" : "alert",
    );
  };

  const renderDetail = (picked?: SatellitePoint | null) => {
    const point =
      picked === undefined
        ? selectedId === null
          ? undefined
          : latestPoints.find((item) => item.noradId === selectedId)
        : picked ?? undefined;
    if (!point) {
      detailTitle.textContent = tr("satDetailHint");
      detailKind.textContent = "—";
      detailCountry.textContent = "—";
      detailAltitude.textContent = "—";
      return;
    }
    detailTitle.textContent = point.name?.trim() ? point.name : "—";
    detailKind.textContent = tr(groupMessageKey(point.group));
    detailCountry.textContent = tr(countryMessageKey(point.country));
    detailAltitude.textContent =
      typeof point.altKm === "number" ? formatAltitude(point.altKm, locale) : "—";
  };

  const publishCatalogStatus = () => {
    if (extraLoad?.error) {
      catalogStatus.hidden = false;
      catalogStatus.textContent = tr("catalogLoadError");
      return;
    }
    catalogStatus.hidden = true;
    catalogStatus.textContent = "";
  };

  const publishScene = (
    stationPoints: SatellitePoint[],
    extrasToDraw: readonly Station[],
    date: Date,
    paths: ReturnType<typeof buildSatelliteScene>["paths"] | undefined,
    focus: { lat: number; lng: number } | undefined,
    frame: { highlight: ReturnType<typeof exclusiveHighlight>; selectedPaths: ReturnType<typeof orbitPathsForStation> },
  ) => {
    const token = ++sceneToken;
    if (extrasToDraw.length === 0) {
      latestPoints = stationPoints;
      globe?.update(stationPoints, paths, focus, frame);
      renderDetail();
      return;
    }

    const collected = stationPoints.slice();
    latestPoints = collected.slice();
    globe?.update(collected, paths, focus, frame);
    let index = 0;
    const step = () => {
      if (token !== sceneToken || !panel.isConnected) {
        return;
      }
      const end = Math.min(index + SCENE_BATCH, extrasToDraw.length);
      const batch = buildSatelliteScene(extrasToDraw.slice(index, end), date, { includeOrbit: false });
      collected.push(...batch.points);
      index = end;
      if (index < extrasToDraw.length) {
        window.requestAnimationFrame(step);
        return;
      }
      latestPoints = collected;
      globe?.update(collected, undefined, undefined, frame);
      renderDetail();
    };
    window.requestAnimationFrame(step);
  };

  const paint = (refreshOrbit: boolean) => {
    panel.setAttribute("aria-busy", catalog ? "false" : "true");
    if (!panel.isConnected || !catalog) {
      renderCard(null);
      renderDetail();
      renderSource();
      publishGlobeStatus();
      publishCatalogStatus();
      return;
    }

    const date = now();
    const highlight = exclusiveHighlight(filter);
    const showDimmed = highlight !== null;
    const showStations = showDimmed || isSatelliteShown({ group: "stations", korean: false }, filter);
    const scene = catalog.error
      ? null
      : buildSatelliteScene(catalog.stations, date, { includeOrbit: refreshOrbit && showStations });
    if (scene && refreshOrbit) {
      passResult = scene.iss ? findNextKoreaPass(scene.iss.station, date) : null;
      passStamp = date.getTime();
    }
    if (!scene?.iss) {
      passResult = null;
    }

    const focus = showStations && scene?.iss && globe && !aimedAtIss
      ? { lat: scene.iss.fix.lat, lng: scene.iss.fix.lng }
      : undefined;
    if (focus) {
      aimedAtIss = true;
    }
    const paths = !showStations ? [] : refreshOrbit ? (scene?.paths ?? []) : undefined;
    const stationPoints = showStations ? (scene?.points ?? []) : [];
    const extrasToDraw = showDimmed ? extras : extras.filter((satellite) => isSatelliteShown(satellite, filter));
    const selected = selectedId === null
      ? null
      : catalog.stations.find((station) => station.noradId === selectedId) ??
        extras.find((station) => station.noradId === selectedId) ??
        null;
    const selectedPaths = selected && selected.noradId !== ISS_NORAD_CATALOG_ID
      ? orbitPathsForStation(selected, date)
      : [];
    publishScene(stationPoints, extrasToDraw, date, paths, focus, { highlight, selectedPaths });
    renderCard(scene?.iss ?? null);
    renderSource();
    publishGlobeStatus();
    publishCatalogStatus();
  };

  const stop = () => {
    window.clearInterval(timer);
    timer = 0;
    sceneToken += 1;
    globe?.destroy();
    globe = null;
  };

  const tick = () => {
    if (!panel.isConnected) {
      stop();
      return;
    }
    if (panel.hidden || document.visibilityState === "hidden") {
      globe?.pause();
      return;
    }
    globe?.resume();
    if (!catalog) {
      return;
    }
    paint(Math.abs(now().getTime() - passStamp) >= ORBIT_REFRESH_MS);
  };

  const ensureGlobe = () => {
    if (globe || globeFailed || globeStarting || !canRenderGlobe()) {
      if (!canRenderGlobe()) {
        globeFailed = true;
      }
      publishGlobeStatus();
      return;
    }

    globeStarting = true;
    void mountSatelliteGlobe(mount, {
      onSelect(point) {
        selectedId = point?.noradId ?? null;
        renderDetail(point);
      },
    })
      .then((mounted) => {
        globeStarting = false;
        if (!panel.isConnected) {
          mounted?.destroy();
          return;
        }
        if (!mounted) {
          globeFailed = true;
          publishGlobeStatus();
          return;
        }
        globe = mounted;
        if (catalog) {
          paint(true);
        }
        publishGlobeStatus();
      })
      .catch(() => {
        globeStarting = false;
        globeFailed = true;
        if (panel.isConnected) {
          publishGlobeStatus();
        }
      });
  };

  const load = () => {
    void Promise.all([readJson("tle.json"), readJson("catalog.json")]).then(([tleFile, catalogFile]) => {
      if (!panel.isConnected) {
        return;
      }
      catalog = tleFile.ok
        ? parseTleDocument(tleFile.payload)
        : { fetchedAt: null, stations: [], error: "error" };
      extraLoad = catalogFile.ok
        ? parseCatalogDocument(catalogFile.payload)
        : { fetchedAt: null, satellites: [], error: null };
      extras = extraLoad.satellites;
      paint(true);
    });
  };

  panel.querySelectorAll<HTMLButtonElement>(".sat-filter").forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.dataset.group;
      if (group && isFilterGroup(group)) {
        filter = toggleFilterGroup(filter, group);
      } else if (button.dataset.filter === "korea-only") {
        filter = toggleKoreaOnly(filter);
      }
      button.setAttribute(
        "aria-pressed",
        button.dataset.filter === "korea-only"
          ? String(filter.koreaOnly)
          : String(group !== undefined && isFilterGroup(group) ? filter.enabled[group] : false),
      );
      paint(false);
    });
  });

  const onVisibility = () => {
    if (!panel.isConnected) {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
      return;
    }
    if (document.visibilityState === "hidden" || panel.hidden) {
      globe?.pause();
      return;
    }
    globe?.resume();
  };

  return {
    show() {
      if (!started) {
        started = true;
        load();
        timer = window.setInterval(tick, POSITION_UPDATE_MS);
        document.addEventListener("visibilitychange", onVisibility);
      }
      ensureGlobe();
      if (catalog) {
        paint(false);
      }
      globe?.resume();
    },
    hide() {
      globe?.pause();
    },
    refresh() {
      paint(false);
    },
  };
}

function createPlayIcon(): SVGSVGElement {
  const svg = createSvg();
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  polygon.setAttribute("points", "7 4 20 12 7 20 7 4");
  svg.append(polygon);
  return svg;
}

const COUNTDOWN_UNITS = ["unitDay", "unitHour", "unitMinute", "unitSecond"] as const;

function createCountdown(): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "countdown";
  bindAria(grid, "countdownAria");

  const mark = document.createElement("span");
  mark.className = "t-minus";
  mark.textContent = "T\u2212";
  mark.setAttribute("aria-hidden", "true");
  grid.append(mark);

  COUNTDOWN_UNITS.forEach((key, index) => {
    const cell = document.createElement("div");
    cell.className = "countdown-cell";

    const value = document.createElement("span");
    value.className = index === COUNTDOWN_UNITS.length - 1
      ? "countdown-value countdown-seconds"
      : "countdown-value";
    value.textContent = "—";

    const label = document.createElement("span");
    label.className = "stat-label";
    bindText(label, key);

    cell.append(value, label);
    grid.append(cell);
  });

  return grid;
}

function launchSourceLabel(fetchedAt: string | null): string {
  if (!fetchedAt) {
    return tr("launchData");
  }
  const date = new Date(fetchedAt);
  if (Number.isNaN(date.getTime())) {
    return tr("launchData");
  }
  return tr("launchDataUpdated", { time: formatKstTime(date) });
}

function fillCountdown(countdown: HTMLElement, parts: CountdownParts | null): void {
  const units = COUNTDOWN_UNITS.map((key) => tr(key));
  const values = ["—", "—", "—", "—"];
  if (parts) {
    values[0] = formatCountdownUnit(parts.days);
    values[1] = formatCountdownUnit(parts.hours);
    values[2] = formatCountdownUnit(parts.minutes);
    values[3] = formatCountdownUnit(parts.seconds);
  }
  const cells = countdown.querySelectorAll(".countdown-cell");
  cells.forEach((cell, index) => {
    const value = values[index] ?? "—";
    const unit = units[index] ?? "";
    const node = cell.querySelector(".countdown-value");
    if (node) {
      node.textContent = value;
    }
    if (cell instanceof HTMLElement) {
      cell.setAttribute("aria-label", `${value} ${unit}`);
    }
  });
}

function createLaterLaunchRow(launch: LaunchItem, now: Date): HTMLElement {
  const row = document.createElement("article");
  row.className = "card card-compact launch-row";

  const copy = document.createElement("div");
  copy.className = "card-copy";

  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = launchVehicle(launch, locale);

  const detail = document.createElement("span");
  detail.className = "stat-label";
  detail.textContent = launchOperatorPlace(launch);

  copy.append(title, detail);

  const when = document.createElement("div");
  when.className = "launch-when";

  const time = document.createElement("span");
  time.className = "launch-time";
  const net = new Date(launch.net);
  time.textContent = formatLaunchDateTime(net, locale);

  const dday = document.createElement("span");
  dday.className = "launch-dday";
  dday.textContent = formatLaunchDday(net, now);

  when.append(time, dday);
  row.append(copy, when);
  return row;
}

function bindLaunches(
  panel: HTMLElement,
  now: () => Date,
  readJson: (fileName: string) => Promise<LocalJson>,
): { show: () => void; hide: () => void; refresh: () => void } | null {
  const title = panel.querySelector("#next-launch-title");
  const meta = panel.querySelector("#next-launch-meta");
  const when = panel.querySelector("#next-launch-when");
  const status = panel.querySelector("#launch-status");
  const countdown = panel.querySelector("#launch-countdown");
  const webcast = panel.querySelector("#launch-webcast");
  const laterBlock = panel.querySelector("#later-block");
  const laterLabel = panel.querySelector("#later-label");
  const later = panel.querySelector("#later-launches");
  const source = panel.querySelector("#launch-source");
  if (
    !(title instanceof HTMLElement) ||
    !(meta instanceof HTMLElement) ||
    !(when instanceof HTMLElement) ||
    !(status instanceof HTMLElement) ||
    !(countdown instanceof HTMLElement) ||
    !(webcast instanceof HTMLAnchorElement) ||
    !(laterBlock instanceof HTMLElement) ||
    !(laterLabel instanceof HTMLElement) ||
    !(later instanceof HTMLElement) ||
    !(source instanceof HTMLElement)
  ) {
    return null;
  }

  const setLaterVisible = (visible: boolean) => {
    laterBlock.hidden = !visible;
    laterLabel.hidden = !visible;
  };

  let catalog: LaunchCatalog | null = null;
  let started = false;
  let timer = 0;
  let builtKey = "";

  const showMessage = (
    message: string,
    fetchedAt: string | null,
    kind: "loading" | "empty" | "error",
  ) => {
    status.hidden = false;
    status.textContent = message;
    setLiveRole(status, kind === "error" ? "alert" : "status");
    title.textContent = "";
    meta.textContent = "";
    when.textContent = "";
    countdown.hidden = true;
    webcast.hidden = true;
    webcast.removeAttribute("href");
    setLaterVisible(false);
    later.replaceChildren();
    source.textContent = fetchedAt ? launchSourceLabel(fetchedAt) : "";
    panel.setAttribute("aria-busy", kind === "loading" ? "true" : "false");
  };

  const paint = () => {
    if (!panel.isConnected) {
      return;
    }

    const upcoming = catalog && !catalog.error ? upcomingLaunches(catalog.launches, now()) : [];
    const next = upcoming[0] ?? null;
    const key = catalog
      ? [
          catalog.error ?? "",
          catalog.fetchedAt ?? "",
          String(kstCalendarDayIndex(now())),
          upcoming.map((launch) => `${launch.id}\u0000${launch.net}`).join("|"),
        ].join("~")
      : "loading";

    if (key !== builtKey) {
      builtKey = key;
      if (!catalog) {
        showMessage(tr("launchLoading"), null, "loading");
        countdown.hidden = false;
        setLaterVisible(true);
        fillCountdown(countdown, null);
        source.textContent = "";
      } else if (catalog.error || !next) {
        showMessage(
          catalog.error ? tr("launchLoadError") : tr("launchEmpty"),
          catalog.fetchedAt,
          catalog.error ? "error" : "empty",
        );
      } else {
        const net = new Date(next.net);
        status.hidden = true;
        status.textContent = "";
        title.textContent = nextLaunchTitle(next, locale);
        meta.textContent = launchOperatorPlace(next);
        when.textContent = formatLaunchDateTime(net, locale);
        countdown.hidden = false;
        if (next.webcastUrl) {
          webcast.hidden = false;
          webcast.href = next.webcastUrl;
        } else {
          webcast.hidden = true;
          webcast.removeAttribute("href");
        }
        setLaterVisible(upcoming.length >= 2);
        later.replaceChildren(
          ...upcoming.slice(1).map((launch) => createLaterLaunchRow(launch, now())),
        );
        source.textContent = launchSourceLabel(catalog.fetchedAt);
        panel.setAttribute("aria-busy", "false");
      }
    }

    if (next && catalog && !catalog.error) {
      fillCountdown(countdown, countdownParts(new Date(next.net), now()));
    }
  };

  const stopTimer = () => {
    window.clearInterval(timer);
    timer = 0;
  };

  const load = () => {
    void readJson("launches.json").then((file) => {
      if (!panel.isConnected) {
        return;
      }
      catalog = file.ok
        ? parseLaunchDocument(file.payload)
        : { fetchedAt: null, launches: [], error: "error" };
      builtKey = "";
      paint();
    });
  };

  const onVisibility = () => {
    if (!panel.isConnected) {
      document.removeEventListener("visibilitychange", onVisibility);
      stopTimer();
      return;
    }
    if (document.visibilityState === "visible" && !panel.hidden) {
      paint();
    }
  };

  return {
    show() {
      if (!started) {
        started = true;
        load();
        document.addEventListener("visibilitychange", onVisibility);
      }
      paint();
      if (!timer) {
        timer = window.setInterval(() => {
          if (!panel.isConnected) {
            stopTimer();
            return;
          }
          if (panel.hidden || document.visibilityState === "hidden") {
            return;
          }
          paint();
        }, COUNTDOWN_UPDATE_MS);
      }
    },
    hide() {
      stopTimer();
    },
    refresh() {
      builtKey = "";
      paint();
    },
  };
}

function createLaunchesPanel(tab: Tab): HTMLElement {
  const panel = createPanel(tab);

  const next = createCard("card card-highlight");
  next.id = "next-launch";

  const head = document.createElement("div");
  head.className = "next-launch-head";

  const badge = document.createElement("span");
  badge.className = "badge";
  bindText(badge, "nextLaunch");

  const when = document.createElement("span");
  when.id = "next-launch-when";
  when.className = "next-launch-when";

  head.append(badge, when);

  const copy = document.createElement("div");
  copy.className = "next-launch-copy";

  const title = document.createElement("h2");
  title.id = "next-launch-title";
  title.className = "next-launch-title";

  const meta = document.createElement("p");
  meta.id = "next-launch-meta";
  meta.className = "next-launch-meta";

  copy.append(title, meta);

  const status = document.createElement("p");
  status.id = "launch-status";
  status.className = "pending";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = tr("launchLoading");

  const countdown = createCountdown();
  countdown.id = "launch-countdown";

  const webcast = document.createElement("a");
  webcast.id = "launch-webcast";
  webcast.className = "webcast-button";
  webcast.target = "_blank";
  webcast.rel = "noopener noreferrer";
  webcast.hidden = true;
  bindAria(webcast, "watchLive");
  const webcastLabel = document.createElement("span");
  bindText(webcastLabel, "watchLive");
  webcast.append(createPlayIcon(), webcastLabel);

  next.append(head, copy, status, countdown, webcast);

  const board = document.createElement("div");
  board.className = "board launch-board";

  const laterBlock = document.createElement("div");
  laterBlock.id = "later-block";
  laterBlock.className = "later-block";

  const laterLabel = document.createElement("h2");
  laterLabel.id = "later-label";
  laterLabel.className = "section-label";
  bindText(laterLabel, "laterLaunches");

  const later = document.createElement("div");
  later.id = "later-launches";
  later.className = "later-list";

  laterBlock.append(laterLabel, later);
  board.append(next, laterBlock);

  const source = document.createElement("p");
  source.id = "launch-source";
  source.className = "orbit-source";

  panel.append(board, source);
  panel.setAttribute("aria-busy", "true");
  return panel;
}

function createTabButton(tab: Tab): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.id = `tab-${tab.id}`;
  button.className = "tab-button";
  button.role = "tab";
  button.setAttribute("aria-controls", `panel-${tab.id}`);
  bindAria(button, tab.labelKey);
  button.dataset.tab = tab.id;

  const label = document.createElement("span");
  bindText(label, tab.labelKey);
  button.append(createTabIcon(tab.id), label);
  return button;
}

function createTabPanel(tab: Tab): HTMLElement {
  if (tab.id === "tonight") {
    return createTonightPanel(tab);
  }
  if (tab.id === "satellites") {
    return createSatellitesPanel(tab);
  }
  return createLaunchesPanel(tab);
}

export type AppOptions = {
  now?: () => Date;
};

function geoErrorKey(code: number): MessageKey {
  if (code === 1) {
    return "geoDenied";
  }
  if (code === 2) {
    return "geoUnavailable";
  }
  if (code === 3) {
    return "geoTimeout";
  }
  return "geoFailed";
}

function locationDisplay(stored: StoredLocation): string {
  if (stored.source === "geolocation") {
    return tr("myLocation");
  }
  const region = REGIONS.find((item) => item.shortName === stored.label);
  const key = region ? regionShortKey(region.id) : null;
  return key ? tr(key) : stored.label;
}

export function createApp(options: AppOptions = {}): HTMLElement {
  locale = resolveLanguage(localStorage, navigator.language || "");
  document.documentElement.lang = locale;
  const generation = ++starGeneration;
  starCatalog = null;
  starStatus = "loading";

  const now = () => options.now?.() ?? new Date();
  document.title = BRAND_NAME;

  const root = document.createElement("div");
  root.className = "app-shell";

  const screen = document.createElement("div");
  screen.className = "screen-body";

  const header = document.createElement("header");
  header.className = "hero";

  const heroTop = document.createElement("div");
  heroTop.className = "hero-top";

  const heroCopy = document.createElement("div");
  heroCopy.className = "hero-copy";

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  bindText(eyebrow, "brandTagline");

  const title = document.createElement("h1");
  title.textContent = BRAND_NAME;

  heroCopy.append(eyebrow, title);

  const heroActions = document.createElement("div");
  heroActions.className = "hero-actions";

  const locationButton = document.createElement("button");
  locationButton.type = "button";
  locationButton.id = "location-button";
  locationButton.className = "location-button";
  locationButton.setAttribute("aria-haspopup", "dialog");
  locationButton.setAttribute("aria-controls", "location-dialog");
  locationButton.setAttribute("aria-expanded", "false");

  const locationLabel = document.createElement("span");
  locationLabel.id = "location-label";
  locationButton.append(createPinIcon(), locationLabel);

  heroActions.append(locationButton);
  heroTop.append(heroCopy, heroActions);
  header.append(heroTop);

  const dialog = document.createElement("div");
  dialog.id = "location-dialog";
  dialog.className = "location-dialog";
  dialog.hidden = true;

  const dialogCard = document.createElement("div");
  dialogCard.className = "location-dialog-card";
  dialogCard.role = "dialog";
  dialogCard.setAttribute("aria-modal", "true");
  dialogCard.setAttribute("aria-labelledby", "location-dialog-title");

  const dialogHeader = document.createElement("div");
  dialogHeader.className = "location-dialog-header";

  const dialogTitle = document.createElement("h2");
  dialogTitle.id = "location-dialog-title";
  bindText(dialogTitle, "locationDialogTitle");

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.id = "location-close";
  closeButton.className = "location-close";
  bindText(closeButton, "close");

  dialogHeader.append(dialogTitle, closeButton);

  const help = document.createElement("p");
  help.className = "location-help";
  bindText(help, "locationHelp");

  const useCurrentButton = document.createElement("button");
  useCurrentButton.type = "button";
  useCurrentButton.id = "use-current-location";
  useCurrentButton.className = "location-primary";
  bindText(useCurrentButton, "useCurrentLocation");

  const error = document.createElement("p");
  error.id = "location-error";
  error.className = "location-error";
  error.role = "alert";
  error.hidden = true;

  const regionList = document.createElement("ul");
  regionList.className = "region-list";

  const regionButtons = new Map<string, HTMLButtonElement>();

  for (const region of REGIONS) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.id = `region-${region.id}`;
    button.className = "region-button";
    button.dataset.region = region.id;
    const nameKey = regionNameKey(region.id);
    if (nameKey) {
      bindText(button, nameKey);
    } else {
      button.textContent = region.name;
    }
    button.setAttribute("aria-pressed", "false");
    item.append(button);
    regionList.append(item);
    regionButtons.set(region.id, button);
  }

  dialogCard.append(dialogHeader, help, useCurrentButton, error, regionList);
  dialog.append(dialogCard);

  const setLocationLabel = () => {
    const stored = loadLocation(localStorage);
    const label = stored ? locationDisplay(stored) : tr("locationChoose");
    locationLabel.textContent = label;
    locationButton.setAttribute("aria-label", stored ? tr("locationChange", { label }) : label);

    for (const region of REGIONS) {
      const button = regionButtons.get(region.id);
      if (button) {
        button.setAttribute(
          "aria-pressed",
          String(stored?.source === "region" && region.shortName === stored.label),
        );
      }
    }
  };

  let locationErrorKey: MessageKey | null = null;

  const showError = (key: MessageKey) => {
    locationErrorKey = key;
    error.hidden = false;
    error.textContent = tr(key);
  };

  const clearError = () => {
    locationErrorKey = null;
    error.hidden = true;
    error.textContent = "";
  };

  const openDialog = () => {
    clearError();
    dialog.hidden = false;
    locationButton.setAttribute("aria-expanded", "true");
    closeButton.focus();
  };

  const closeDialog = () => {
    dialog.hidden = true;
    locationButton.setAttribute("aria-expanded", "false");
  };

  let refreshTonight = (): void => {};

  const persistLocation = (input: LocationInput) => {
    saveLocation(localStorage, input);
    setLocationLabel();
    closeDialog();
    refreshTonight();
  };

  locationButton.addEventListener("click", () => {
    openDialog();
  });

  closeButton.addEventListener("click", () => {
    closeDialog();
    locationButton.focus();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      closeDialog();
      locationButton.focus();
    }
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDialog();
      locationButton.focus();
    }
  });

  useCurrentButton.addEventListener("click", () => {
    const geolocation = navigator.geolocation;
    if (!geolocation) {
      showError("geoUnsupported");
      return;
    }

    useCurrentButton.disabled = true;
    clearError();

    geolocation.getCurrentPosition(
      (position) => {
        useCurrentButton.disabled = false;
        try {
          persistLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            label: "내 위치",
            source: "geolocation",
          });
        } catch {
          showError("saveFailed");
        }
      },
      (positionError) => {
        useCurrentButton.disabled = false;
        showError(geoErrorKey(positionError.code));
      },
      GEOLOCATION_OPTIONS,
    );
  });

  for (const region of REGIONS) {
    regionButtons.get(region.id)?.addEventListener("click", () => {
      try {
        persistLocation({
          latitude: region.latitude,
          longitude: region.longitude,
          label: region.shortName,
          source: "region",
        });
      } catch {
        showError("regionSaveFailed");
      }
    });
  }

  const desktopBar = document.createElement("header");
  desktopBar.className = "desktop-bar";

  const desktopBarInner = document.createElement("div");
  desktopBarInner.className = "desktop-bar-inner";

  const brand = document.createElement("a");
  brand.className = "brand-logo";
  brand.href = "#panel-tonight";

  const brandName = document.createElement("span");
  brandName.className = "brand-name";
  brandName.textContent = BRAND_NAME;
  brand.append(createBrandIcon(), brandName);

  const desktopNav = document.createElement("nav");
  desktopNav.className = "desktop-nav";
  bindAria(desktopNav, "desktopNavAria");

  const desktopTools = document.createElement("div");
  desktopTools.className = "desktop-tools";

  const languageButton = document.createElement("button");
  languageButton.type = "button";
  languageButton.id = "language-button";
  languageButton.className = "language-button";
  const koreanCode = document.createElement("span");
  koreanCode.dataset.lang = "ko";
  koreanCode.textContent = "KO";
  const languageSeparator = document.createElement("span");
  languageSeparator.setAttribute("aria-hidden", "true");
  languageSeparator.textContent = " · ";
  const englishCode = document.createElement("span");
  englishCode.dataset.lang = "en";
  englishCode.textContent = "EN";
  languageButton.append(koreanCode, languageSeparator, englishCode);
  bindAria(languageButton, "languageSwitch");
  markLanguageButton(languageButton);

  desktopTools.append(languageButton);
  desktopBarInner.append(brand, desktopNav, desktopTools);
  desktopBar.append(desktopBarInner);

  const tabList = document.createElement("nav");
  tabList.className = "tab-list";
  tabList.role = "tablist";
  bindAria(tabList, "tabListAria");

  const panels = document.createElement("main");
  panels.className = "panel-stack";

  const buttons = tabs.map(createTabButton);
  const desktopButtons = tabs.map((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `desktop-tab-${tab.id}`;
    button.className = "desktop-tab";
    button.dataset.desktopTab = tab.id;
    bindText(button, tab.labelKey);
    button.setAttribute("aria-controls", `panel-${tab.id}`);
    return button;
  });
  const panelElements = tabs.map(createTabPanel);

  tabList.append(...buttons);
  desktopNav.append(...desktopButtons);
  panels.append(...panelElements);

  const readJson = createLocalJsonReader();
  const satellitesPanel = panelElements.find((panel) => panel.id === "panel-satellites");
  const satellites = satellitesPanel ? bindSatellites(satellitesPanel, now, readJson) : null;
  const launchesPanel = panelElements.find((panel) => panel.id === "panel-launches");
  const launches = launchesPanel ? bindLaunches(launchesPanel, now, readJson) : null;

  let currentTab: TabId = "tonight";

  const placeLocationControl = (desktop: boolean) => {
    if (desktop) {
      desktopTools.append(locationButton, languageButton);
      heroActions.remove();
      return;
    }
    heroActions.append(locationButton, languageButton);
    if (heroActions.parentElement !== heroTop) {
      heroTop.append(heroActions);
    }
  };

  const setActiveTab = (activeTab: TabId) => {
    currentTab = activeTab;
    const desktop = isDesktopViewport();
    root.classList.toggle("is-desktop", desktop);
    placeLocationControl(desktop);

    buttons.forEach((button) => {
      const isActive = button.dataset.tab === activeTab;
      button.setAttribute("aria-selected", String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    });

    desktopButtons.forEach((button) => {
      const isActive = button.dataset.desktopTab === activeTab;
      if (isActive) {
        button.setAttribute("aria-current", "true");
      } else {
        button.removeAttribute("aria-current");
      }
    });

    panelElements.forEach((panel) => {
      panel.hidden = !desktop && panel.id !== `panel-${activeTab}`;
    });

    if (desktop || activeTab === "satellites") {
      satellites?.show();
    } else {
      satellites?.hide();
    }

    if (desktop || activeTab === "launches") {
      launches?.show();
    } else {
      launches?.hide();
    }
  };

  const scrollToTab = (activeTab: TabId) => {
    if (!isDesktopViewport()) {
      return;
    }
    const panel = document.getElementById(`panel-${activeTab}`);
    if (!panel || typeof panel.scrollIntoView !== "function") {
      return;
    }
    panel.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const activeTab = button.dataset.tab as TabId;
      setActiveTab(activeTab);
      scrollToTab(activeTab);
    });
  });

  desktopButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const activeTab = button.dataset.desktopTab as TabId;
      setActiveTab(activeTab);
      scrollToTab(activeTab);
    });
  });

  brand.addEventListener("click", (event) => {
    event.preventDefault();
    setActiveTab("tonight");
    scrollToTab("tonight");
  });

  const onResize = () => {
    if (!root.isConnected) {
      window.removeEventListener("resize", onResize);
      return;
    }
    setActiveTab(currentTab);
  };
  window.addEventListener("resize", onResize);

  const footer = document.createElement("p");
  footer.className = "source-footer";
  const staleNotice = document.createElement("p");
  staleNotice.id = "stale-notice";
  staleNotice.className = "stale-notice";
  staleNotice.hidden = true;
  let orbitFetchedAt: string | null = null;
  let launchFetchedAt: string | null = null;
  const updateFooter = () => {
    footer.textContent = dataSourceFooter(orbitFetchedAt, launchFetchedAt, locale);
    const notice = staleDataNotice([orbitFetchedAt, launchFetchedAt], now(), locale);
    if (notice) {
      staleNotice.hidden = false;
      staleNotice.textContent = notice;
      return;
    }
    staleNotice.hidden = true;
    staleNotice.textContent = "";
  };
  updateFooter();
  const issLoad: IssOrbitLoad = {
    state: "loading",
    station: null,
    cacheKey: "",
    cache: [],
  };

  void Promise.all([readJson("tle.json"), readJson("launches.json")]).then(([orbitFile, launchFile]) => {
    if (!footer.isConnected) {
      return;
    }
    if (orbitFile.ok) {
      const catalog = parseTleDocument(orbitFile.payload);
      orbitFetchedAt = catalog.fetchedAt;
      const iss = catalog.stations.find((station) => station.noradId === ISS_NORAD_CATALOG_ID) ?? null;
      issLoad.station = iss;
      issLoad.cacheKey = "";
      issLoad.cache = [];
      if (iss) {
        issLoad.state = "ready";
      } else {
        issLoad.state = catalog.error ? "error" : "missing";
      }
    } else {
      orbitFetchedAt = null;
      issLoad.station = null;
      issLoad.state = "error";
    }
    launchFetchedAt = launchFile.ok ? parseLaunchDocument(launchFile.payload).fetchedAt : null;
    updateFooter();
    refreshTonight();
  });

  screen.append(header, panels, footer, staleNotice);
  root.append(desktopBar, screen, tabList, dialog);
  setActiveTab("tonight");
  setLocationLabel();

  const tonightPanel = panelElements.find((panel) => panel.id === "panel-tonight");
  refreshTonight = () => {
    if (tonightPanel) {
      fillTonightPanel(tonightPanel, now(), issLoad);
    }
  };
  refreshTonight();
  void readJson("stars.json").then((file) => {
    if (generation !== starGeneration || !root.isConnected) {
      return;
    }
    const parsed = file.ok ? parseStarCatalog(file.payload) : null;
    if (parsed) {
      starCatalog = parsed;
      starStatus = "ready";
    } else {
      starCatalog = null;
      starStatus = "error";
    }
    refreshTonight();
  });

  const applyLocale = () => {
    document.documentElement.lang = locale;
    applyBoundCopy(root);
    markLanguageButton(languageButton);
    setLocationLabel();
    if (locationErrorKey) {
      showError(locationErrorKey);
    }
    refreshTonight();
    satellites?.refresh();
    launches?.refresh();
    updateFooter();
  };

  languageButton.addEventListener("click", () => {
    locale = locale === "ko" ? "en" : "ko";
    saveLanguage(localStorage, locale);
    applyLocale();
  });

  return root;
}
