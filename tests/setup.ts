import { beforeEach } from "vitest";

// jsdom starts at 1024px, which is already the desktop dashboard.
// Phone tests stay on the narrow layout unless a test sets a width.
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
