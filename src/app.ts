import {
  REGIONS,
  geolocationErrorMessage,
  loadLocation,
  saveLocation,
  type LocationInput,
} from "./location";

type TabId = "tonight" | "satellites" | "launches";

type Tab = {
  id: TabId;
  label: string;
  title: string;
  description: string;
};

const tabs: Tab[] = [
  {
    id: "tonight",
    label: "오늘 밤",
    title: "오늘 밤",
    description: "일몰, 달, 행성, ISS 통과 정보를 이곳에 표시합니다.",
  },
  {
    id: "satellites",
    label: "위성 지구본",
    title: "위성 지구본",
    description: "ISS와 우주정거장 위성의 실시간 위치를 이곳에 표시합니다.",
  },
  {
    id: "launches",
    label: "발사 일정",
    title: "발사 일정",
    description: "다가오는 로켓 발사 일정과 카운트다운을 이곳에 표시합니다.",
  },
];

const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 60_000,
};

function createTabButton(tab: Tab): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.id = `tab-${tab.id}`;
  button.className = "tab-button";
  button.role = "tab";
  button.textContent = tab.label;
  button.setAttribute("aria-controls", `panel-${tab.id}`);
  button.dataset.tab = tab.id;
  return button;
}

function createTabPanel(tab: Tab): HTMLElement {
  const panel = document.createElement("section");
  panel.id = `panel-${tab.id}`;
  panel.className = "panel";
  panel.role = "tabpanel";
  panel.setAttribute("aria-labelledby", `tab-${tab.id}`);

  const heading = document.createElement("h2");
  heading.textContent = tab.title;

  const description = document.createElement("p");
  description.textContent = tab.description;

  panel.append(heading, description);
  return panel;
}

function createPinIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "#F5B544");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z");

  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "10");
  circle.setAttribute("r", "2.5");

  svg.append(path, circle);
  return svg;
}

export function createApp(): HTMLElement {
  const root = document.createElement("div");
  root.className = "app-shell";

  const header = document.createElement("header");
  header.className = "hero";

  const heroTop = document.createElement("div");
  heroTop.className = "hero-top";

  const heroCopy = document.createElement("div");
  heroCopy.className = "hero-copy";

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Tonight Sky";

  const title = document.createElement("h1");
  title.textContent = "오늘 밤 하늘";

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

  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = "내 위치 기준 밤하늘 정보를 한 화면에서 확인합니다.";

  header.append(heroTop, subtitle);

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

  const persistLocation = (input: LocationInput) => {
    const saved = saveLocation(localStorage, input);
    setLocationLabel(saved.label);
    closeDialog();
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

  const footer = document.createElement("footer");
  footer.className = "source-footer";
  footer.textContent = "데이터 출처: CelesTrak, The Space Devs";

  root.append(header, tabList, panels, footer, dialog);
  setActiveTab("tonight");
  setLocationLabel(loadLocation(localStorage)?.label ?? null);

  return root;
}
