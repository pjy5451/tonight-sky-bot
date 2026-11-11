import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

declare const process: {
  cwd(): string;
};

const DESCRIPTION = "오늘 밤, 하늘을 탐험하다. 내 위치의 하늘, 실시간 위성, 로켓 발사 일정.";
const SITE = "https://argonova.pages.dev";
const STAR_PATH = "M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z";
const ROOT = process.cwd();

function readText(path: string): string {
  return new TextDecoder().decode(readFileSync(path));
}

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) {
      throw new Error("PNG가 아닙니다.");
    }
  }
  const type = String.fromCharCode(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0);
  if (type !== "IHDR") {
    throw new Error("PNG IHDR가 없습니다.");
  }
  const width = ((bytes[16] ?? 0) << 24) | ((bytes[17] ?? 0) << 16) | ((bytes[18] ?? 0) << 8) | (bytes[19] ?? 0);
  const height = ((bytes[20] ?? 0) << 24) | ((bytes[21] ?? 0) << 16) | ((bytes[22] ?? 0) << 8) | (bytes[23] ?? 0);
  return { width, height };
}

function expectShareMarkup(html: string, manifestText: string): void {
  expect(html).toContain("<title>Argonova</title>");
  expect(html).toContain('name="description"');
  expect(html).toContain(DESCRIPTION);
  expect(html).toContain('property="og:title" content="Argonova"');
  expect(html).toContain('property="og:site_name" content="Argonova"');
  expect(html).toContain('property="og:description"');
  expect(html).toContain(`property="og:url" content="${SITE}"`);
  expect(html).toContain(`property="og:image" content="${SITE}/og.png"`);
  expect(html).toContain('property="og:image:width" content="1200"');
  expect(html).toContain('property="og:image:height" content="630"');
  expect(html).toContain('property="og:image:alt" content="Argonova"');
  expect(html).toContain('name="twitter:title" content="Argonova"');
  expect(html).toContain('name="theme-color" content="#0B1020"');
  expect(html).toContain('name="mobile-web-app-capable" content="yes"');
  expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
  expect(html).toContain('name="apple-mobile-web-app-title" content="Argonova"');
  expect(html).toContain('rel="icon" href="./favicon.svg"');
  expect(html).toContain('rel="apple-touch-icon" href="./icons/apple-touch-icon.png"');
  expect(html).toContain('rel="manifest" href="./manifest.webmanifest"');

  const manifest = JSON.parse(manifestText) as {
    name: string;
    short_name: string;
    description: string;
    start_url: string;
    scope: string;
    display: string;
    background_color: string;
    theme_color: string;
    icons: Array<{ src: string; sizes: string; type: string }>;
  };
  expect(manifest.name).toBe("Argonova");
  expect(manifest.short_name).toBe("Argonova");
  expect(manifest.description).toBe(DESCRIPTION);
  expect(manifest.start_url).toBe("./");
  expect(manifest.scope).toBe("./");
  expect(manifest.display).toBe("standalone");
  expect(manifest.background_color).toBe("#0B1020");
  expect(manifest.theme_color).toBe("#0B1020");
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(["192x192", "512x512"]);
  for (const icon of manifest.icons) {
    expect(icon.type).toBe("image/png");
    expect(icon.src.startsWith("./icons/")).toBe(true);
  }
}

describe("share metadata and home screen", () => {
  it("puts the title, description, and Open Graph image in the page", () => {
    const html = readText(join(ROOT, "index.html"));
    const manifestText = readText(join(ROOT, "public/manifest.webmanifest"));
    expectShareMarkup(html, manifestText);

    const favicon = readText(join(ROOT, "public/favicon.svg"));
    expect(favicon).toContain("#0B1020");
    expect(favicon).toContain("#F5B544");
    expect(favicon).toContain(STAR_PATH);

    const og = readFileSync(join(ROOT, "public/og.png"));
    expect(pngSize(og)).toEqual({ width: 1200, height: 630 });
    expect(og.byteLength).toBeGreaterThan(5_000);
    expect(og.byteLength).toBeLessThanOrEqual(600 * 1024);

    const icons = [
      ["public/icons/icon-192.png", 192],
      ["public/icons/icon-512.png", 512],
      ["public/icons/apple-touch-icon.png", 180],
    ] as const;
    for (const [path, size] of icons) {
      const bytes = readFileSync(join(ROOT, path));
      expect(pngSize(bytes)).toEqual({ width: size, height: size });
      expect(bytes.byteLength).toBeGreaterThan(500);
    }
  });

  it("copies the manifest, meta tags, and icons into the build output", () => {
    const outDir = mkdtempSync(join(tmpdir(), "argonova-share-"));
    try {
      execFileSync(
        join(ROOT, "node_modules", ".bin", "vite"),
        ["build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"],
        { cwd: ROOT, timeout: 120_000, encoding: "utf8" },
      );
      expectShareMarkup(
        readText(join(outDir, "index.html")),
        readText(join(outDir, "manifest.webmanifest")),
      );
      expect(pngSize(readFileSync(join(outDir, "og.png")))).toEqual({ width: 1200, height: 630 });
      expect(pngSize(readFileSync(join(outDir, "icons/icon-192.png")))).toEqual({
        width: 192,
        height: 192,
      });
      expect(pngSize(readFileSync(join(outDir, "icons/icon-512.png")))).toEqual({
        width: 512,
        height: 512,
      });
      expect(pngSize(readFileSync(join(outDir, "icons/apple-touch-icon.png")))).toEqual({
        width: 180,
        height: 180,
      });
      expect(readText(join(outDir, "favicon.svg"))).toContain(STAR_PATH);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);
});
