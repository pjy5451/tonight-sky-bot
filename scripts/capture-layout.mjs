/**
 * 1200px 배치와 그 아래 탭 화면을 Playwright로 캡처한다.
 * 사용: `npx playwright install chromium` 한 번, `npm run build`, 그다음 `node scripts/capture-layout.mjs`
 * 결과: tests/screenshots/layout-1440.png, layout-1024.png, layout-390.png
 */
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const outDir = path.join(root, "tests", "screenshots");

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

const shots = [
  { name: "layout-1440.png", width: 1440, height: 1100 },
  { name: "layout-1024.png", width: 1024, height: 900 },
  { name: "layout-390.png", width: 390, height: 844 },
];

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

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
try {
  await mkdir(outDir, { recursive: true });
  for (const shot of shots) {
    const page = await browser.newPage({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 1,
      locale: "ko-KR",
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await page.waitForSelector("h1");
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, shot.name) });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
