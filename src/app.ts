import {
  REGIONS,
  geolocationErrorMessage,
  loadLocation,
  saveLocation,
  type LocationInput,
} from "./location";
import {
  computeTonightSky,
  directionSkyLabel,
  formatKstTime,
  moonLitPath,
  type TonightSky,
} from "./sky";

type TabId = "tonight" | "satellites" | "launches";

type Tab = {
  id: TabId;
  label: string;
};

const BRAND_NAME = "Argonova";
const BRAND_TAGLINE = "오늘 밤, 하늘을 탐험하다";
const PENDING_LABEL = "준비 중";

const tabs: Tab[] = [
  { id: "tonight", label: "오늘 밤" },
  { id: "satellites", label: "위성 지구본" },
  { id: "launches", label: "발사 일정" },
];

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
  svg.setAttribute("stroke-width", "2");
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

function createPinIcon(): SVGSVGElement {
  const svg = createSvg();
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("stroke", "#F5B544");

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

function createPendingText(): HTMLParagraphElement {
  const pending = document.createElement("p");
  pending.className = "pending";
  pending.textContent = PENDING_LABEL;
  return pending;
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

function createTimeStat(id: string, label: string): HTMLElement {
  const card = createCard("stat-card");
  const labelElement = document.createElement("span");
  labelElement.className = "stat-label";
  labelElement.textContent = label;

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
  disk.setAttribute("fill", "#2A3550");
  svg.append(disk);

  const lit = moonLitPath(phaseAngle, latitude < 0);
  if (lit) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", lit);
    path.setAttribute("fill", "#F2F4F8");
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
    name.textContent = planet.name;

    const detail = document.createElement("span");
    detail.className = "planet-detail";
    detail.textContent = directionSkyLabel(planet.direction);

    row.append(dot, name, detail);
    list.append(row);
  }
}

function fillTonightPanel(panel: HTMLElement, date: Date): void {
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
    planetEmpty.textContent = "위치를 선택하면 오늘 밤 하늘을 계산합니다.";
    return;
  }

  const sky = computeTonightSky(location, date);
  setClockValue(sunset, sky.sunset, "지지 않음");
  setClockValue(sunrise, sky.sunrise, "뜨지 않음");
  moonValue.textContent = `${sky.moonIlluminationPercent}%`;
  moonValue.classList.remove("is-note");
  moonIcon.replaceChildren(renderMoonIcon(sky.moonPhaseAngle, location.latitude));
  moonName.textContent = sky.moonPhaseName;
  renderPlanetRows(planetList, sky.planets);
  planetEmpty.hidden = sky.planets.length > 0;
  planetEmpty.textContent =
    sky.planets.length > 0 ? "" : "지금 지평선 위에 있는 행성이 없습니다.";
}

function createTonightPanel(tab: Tab): HTMLElement {
  const panel = createPanel(tab);

  const stats = document.createElement("div");
  stats.className = "stat-grid";

  const moon = createCard("stat-card");
  const moonLabel = document.createElement("span");
  moonLabel.className = "stat-label";
  moonLabel.textContent = "달";

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

  stats.append(createTimeStat("sunset-value", "일몰"), createTimeStat("sunrise-value", "일출"), moon);

  const iss = createCard("card card-highlight");
  iss.append(createCardTitle("ISS 통과"), createPendingText());

  const planets = createCard("card");
  planets.append(createCardTitle("밝게 보이는 행성"));

  const planetList = document.createElement("div");
  planetList.id = "planet-list";
  planetList.className = "planet-list";

  const planetEmpty = document.createElement("p");
  planetEmpty.id = "planet-empty";
  planetEmpty.className = "pending";
  planetEmpty.textContent = "위치를 선택하면 오늘 밤 하늘을 계산합니다.";
  planets.append(planetList, planetEmpty);

  const meteor = createCard("card card-row");
  const meteorCopy = document.createElement("div");
  meteorCopy.className = "card-copy";
  const meteorLabel = document.createElement("span");
  meteorLabel.className = "stat-label";
  meteorLabel.textContent = "다음 유성우";
  meteorCopy.append(meteorLabel, createCardTitle("준비 중"));
  meteor.append(meteorCopy);

  panel.append(stats, iss, planets, meteor);
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

function createSatellitesPanel(tab: Tab): HTMLElement {
  const panel = createPanel(tab);

  const globe = createCard("globe-placeholder");
  globe.append(createPendingText());

  const legend = document.createElement("div");
  legend.className = "legend";
  legend.append(
    createLegendItem("legend-dot-iss", "ISS"),
    createLegendItem("legend-dot-other", "다른 우주정거장·위성"),
  );

  const iss = createCard("card card-highlight");
  iss.append(createCardTitle("국제우주정거장 (ISS)"), createPendingText());

  panel.append(globe, legend, iss);
  return panel;
}

function createCountdown(): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "countdown";

  for (const unit of ["일", "시간", "분", "초"]) {
    const cell = document.createElement("div");
    cell.className = "countdown-cell";

    const value = document.createElement("span");
    value.className = "countdown-value";
    value.textContent = PENDING_LABEL;

    const label = document.createElement("span");
    label.className = "stat-label";
    label.textContent = unit;

    cell.append(value, label);
    grid.append(cell);
  }

  return grid;
}

function createLaunchesPanel(tab: Tab): HTMLElement {
  const panel = createPanel(tab);

  const next = createCard("card card-highlight");
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = "다음 발사";
  next.append(badge, createPendingText(), createCountdown());

  const laterLabel = document.createElement("h2");
  laterLabel.className = "section-label";
  laterLabel.textContent = "이후 일정";

  const later = createCard("card card-compact");
  later.append(createPendingText());

  panel.append(next, laterLabel, later);
  return panel;
}

function createTabButton(tab: Tab): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.id = `tab-${tab.id}`;
  button.className = "tab-button";
  button.role = "tab";
  button.setAttribute("aria-controls", `panel-${tab.id}`);
  button.dataset.tab = tab.id;

  const label = document.createElement("span");
  label.textContent = tab.label;
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

export function createApp(options: AppOptions = {}): HTMLElement {
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
  eyebrow.textContent = BRAND_TAGLINE;

  const title = document.createElement("h1");
  title.textContent = BRAND_NAME;

  heroCopy.append(eyebrow, title);

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

  heroTop.append(heroCopy, locationButton);
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
  dialogTitle.textContent = "위치 선택";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.id = "location-close";
  closeButton.className = "location-close";
  closeButton.textContent = "닫기";

  dialogHeader.append(dialogTitle, closeButton);

  const help = document.createElement("p");
  help.className = "location-help";
  help.textContent = "좌표는 소수점 1자리로 반올림해 이 기기에만 저장합니다.";

  const useCurrentButton = document.createElement("button");
  useCurrentButton.type = "button";
  useCurrentButton.id = "use-current-location";
  useCurrentButton.className = "location-primary";
  useCurrentButton.textContent = "현재 위치 사용";

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
    button.textContent = region.name;
    button.setAttribute("aria-pressed", "false");
    item.append(button);
    regionList.append(item);
    regionButtons.set(region.id, button);
  }

  dialogCard.append(dialogHeader, help, useCurrentButton, error, regionList);
  dialog.append(dialogCard);

  const setLocationLabel = (label: string | null) => {
    if (label) {
      locationLabel.textContent = label;
      locationButton.setAttribute("aria-label", `위치 ${label}, 변경`);
    } else {
      locationLabel.textContent = "위치 선택";
      locationButton.setAttribute("aria-label", "위치 선택");
    }

    for (const region of REGIONS) {
      const button = regionButtons.get(region.id);
      if (button) {
        button.setAttribute("aria-pressed", String(region.shortName === label));
      }
    }
  };

  const showError = (message: string) => {
    error.hidden = false;
    error.textContent = message;
  };

  const clearError = () => {
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
    const saved = saveLocation(localStorage, input);
    setLocationLabel(saved.label);
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
      showError("이 브라우저에서는 현재 위치를 사용할 수 없습니다. 시·도를 선택해 주세요.");
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
          showError("좌표를 저장하지 못했습니다. 시·도를 선택해 주세요.");
        }
      },
      (positionError) => {
        useCurrentButton.disabled = false;
        showError(geolocationErrorMessage(positionError.code));
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
        showError("선택한 위치를 저장하지 못했습니다.");
      }
    });
  }

  const tabList = document.createElement("nav");
  tabList.className = "tab-list";
  tabList.role = "tablist";
  tabList.setAttribute("aria-label", "화면 탭");

  const panels = document.createElement("main");
  panels.className = "panel-stack";

  const buttons = tabs.map(createTabButton);
  const panelElements = tabs.map(createTabPanel);

  tabList.append(...buttons);
  panels.append(...panelElements);

  const setActiveTab = (activeTab: TabId) => {
    buttons.forEach((button) => {
      const isActive = button.dataset.tab === activeTab;
      button.setAttribute("aria-selected", String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    });

    panelElements.forEach((panel) => {
      panel.hidden = panel.id !== `panel-${activeTab}`;
    });
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tab as TabId);
    });
  });

  const footer = document.createElement("p");
  footer.className = "source-footer";
  footer.textContent = "데이터: CelesTrak · The Space Devs";

  screen.append(header, panels, footer);
  root.append(screen, tabList, dialog);
  setActiveTab("tonight");
  setLocationLabel(loadLocation(localStorage)?.label ?? null);

  const tonightPanel = panelElements.find((panel) => panel.id === "panel-tonight");
  refreshTonight = () => {
    if (tonightPanel) {
      fillTonightPanel(tonightPanel, now());
    }
  };
  refreshTonight();

  return root;
}
