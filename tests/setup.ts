import { beforeEach } from "vitest";

// jsdom starts at 1024px. The year1 dashboard begins at 1200px,
// so phone tests stay on the tab layout unless a test sets a wider width.
beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 390,
  });
  Object.defineProperty(navigator, "language", {
    configurable: true,
    value: "ko-KR",
  });
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    value: ["ko-KR"],
  });
  document.documentElement.lang = "ko";
});
