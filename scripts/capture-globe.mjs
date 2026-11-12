/**
 * 기본 시점 지구본을 Playwright로 캡처한다.
 * 사용: `npx playwright install chromium` 한 번, `npm run build`, 그다음 `node scripts/capture-globe.mjs`
 * 결과: tests/screenshots/globe-default.png
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const outDir = path.join(root, "tests", "screenshots");
const outFile = path.join(outDir, "globe-default.png");
const layoutShots = [
  { width: 390, height: 844, file: "globe-layout-390.png" },
  { width: 1440, height: 1000, file: "globe-layout-1440.png" },
];

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = path.join(dist, path.normalize(relative));
  if (!file.startsWith(dist)) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});

for (const name of ["tle.json", "catalog.json", "launches.json"]) {
  try {
    const bytes = execFileSync("git", ["show", `origin/data:public/data/${name}`], { cwd: root, maxBuffer: 8_000_000 });
    if (bytes.length > 10) {
      await writeFile(path.join(dist, "data", name), bytes);
    }
  } catch {
    // 데이터 브랜치가 없으면 저장소에 있는 파일을 그대로 쓴다.
  }
}

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 900, height: 780 },
    deviceScaleFactor: 1,
    locale: "ko-KR",
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.click("#tab-satellites");
  await page.waitForSelector("#globe-mount canvas", { timeout: 20000 });
  await page.waitForFunction(() => {
    const altitude = document.querySelector("#iss-altitude")?.textContent ?? "";
    return /\d/.test(altitude);
  }, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: ".globe-hud,.legend,.sat-filters,.globe-status{display:none !important}" });
  await page.waitForTimeout(300);
  await mkdir(outDir, { recursive: true });
  await page.locator("#globe-mount canvas").screenshot({ path: outFile });

  for (const shot of layoutShots) {
    const layout = await browser.newPage({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 1,
      locale: "ko-KR",
    });
    await layout.addInitScript(() => {
      localStorage.setItem(
        "tonight-sky-location",
        JSON.stringify({ latitude: 37.6, longitude: 127, label: "서울", source: "region" }),
      );
    });
    await layout.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    if (shot.width < 1024) {
      await layout.click("#tab-satellites");
    }
    await layout.waitForFunction(() => {
      const name = document.querySelector("#sat-selection-name")?.textContent ?? "";
      const pass = document.querySelector("#sat-selection-pass")?.textContent ?? "";
      const readyName = name.length > 0 && name !== "—" && name !== "-";
      const readyPass = /\d{2}:\d{2}/.test(pass) || pass.includes("예정된 통과 없음");
      return readyName && readyPass;
    }, { timeout: 20000 });
    await layout.waitForTimeout(400);
    await layout.screenshot({ path: path.join(outDir, shot.file), fullPage: true });
    await layout.close();
  }
} finally {
  await browser.close();
  server.close();
}
