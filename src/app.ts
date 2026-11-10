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

export function createApp(): HTMLElement {
  const root = document.createElement("div");
  root.className = "app-shell";

  const header = document.createElement("header");
  header.className = "hero";

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Tonight Sky";

  const title = document.createElement("h1");
  title.textContent = "오늘 밤 하늘";

  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = "내 위치 기준 밤하늘 정보를 한 화면에서 확인합니다.";

  header.append(eyebrow, title, subtitle);

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

  root.append(header, tabList, panels, footer);
  setActiveTab("tonight");

  return root;
}
