import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

declare const process: {
  cwd(): string;
};

const ROOT = process.cwd();

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const EXPECTED_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(self), camera=(), microphone=(), payment=(), usb=()",
};

const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

function readText(path: string): string {
  return new TextDecoder().decode(readFileSync(path));
}

function parseCloudflareHeaders(text: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (!/^\s/.test(raw)) {
      current = new Map();
      rules.set(trimmed, current);
      continue;
    }
    if (!current) {
      throw new Error("_headers 경로가 없습니다.");
    }
    const separator = raw.indexOf(":");
    if (separator < 0) {
      throw new Error("_headers 형식이 아닙니다.");
    }
    const name = raw.slice(0, separator).trim();
    const value = raw.slice(separator + 1).trim();
    current.set(name, value);
  }
  return rules;
}

function expectHeaders(text: string): void {
  const rules = parseCloudflareHeaders(text);
  expect([...rules.keys()]).toEqual(["/*"]);
  const site = rules.get("/*");
  expect(site).toBeDefined();
  expect([...(site?.keys() ?? [])]).toEqual(Object.keys(EXPECTED_HEADERS));
  for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
    expect(site?.get(name)).toBe(value);
  }
}

function attributeUrls(html: string, tag: string, attribute: string): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*\\b${attribute}=["']([^"']+)["'][^>]*>`, "gi");
  return [...html.matchAll(pattern)].map((match) => match[1] ?? "");
}

describe("security headers", () => {
  it("sets the Cloudflare Pages policy on every path", () => {
    expectHeaders(readText(join(ROOT, "public/_headers")));
  });

  it("keeps tonight, globe, and launch resources inside the policy", () => {
    const html = readText(join(ROOT, "index.html"));
    const stylesheets = attributeUrls(html, "link", "href").filter((_, index) => {
      const tag = attributeUrls(html, "link", "rel")[index] ?? "";
      return tag.toLowerCase() === "stylesheet";
    });
    expect(stylesheets).toEqual([
      "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=Space+Grotesk:wght@500;700&display=swap",
    ]);

    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
    for (const link of links) {
      const rel = /rel=["']([^"']+)["']/i.exec(link)?.[1] ?? "";
      const href = /href=["']([^"']+)["']/i.exec(link)?.[1] ?? "";
      expect(href.startsWith("javascript:")).toBe(false);
      if (rel.toLowerCase() === "stylesheet" || rel.toLowerCase() === "preconnect") {
        expect(FONT_HOSTS.has(new URL(href).host)).toBe(true);
        continue;
      }
      expect(href.startsWith("http://") || href.startsWith("https://")).toBe(false);
    }

    const scripts = attributeUrls(html, "script", "src");
    expect(scripts).toEqual(["/src/main.ts"]);
    expect(html.includes("<iframe")).toBe(false);

    const globeSource = readText(join(ROOT, "src/globe-view.ts"));
    const textureSource = readText(join(ROOT, "src/earth-textures.ts"));
    expect(textureSource).toContain("textures/earth-day.jpg");
    expect(textureSource).toContain("textures/earth-night.jpg");
    expect(globeSource).toContain("startupTextures()");
    expect(globeSource.includes("https://") || globeSource.includes("http://")).toBe(false);
    expect(textureSource.includes("https://") || textureSource.includes("http://")).toBe(false);

    const appSource = readText(join(ROOT, "src/app.ts"));
    expect(appSource).toContain("fetch(`${import.meta.env.BASE_URL}data/${fileName}`)");
    expect(appSource.includes("iframe")).toBe(false);
    expect(appSource.includes("innerHTML")).toBe(false);

    const styleSource = readText(join(ROOT, "src/styles.css"));
    expect(styleSource.includes("url(")).toBe(false);

    const browserSource = ["app.ts", "globe-view.ts", "earth-textures.ts", "launches.ts", "main.ts", "sky.ts", "satellites.ts", "meteors.ts", "location.ts", "sources.ts"]
      .map((name) => readText(join(ROOT, "src", name)))
      .join("\n");
    for (const host of ["unpkg.com", "jsdelivr.net", "cdnjs.cloudflare.com"]) {
      expect(browserSource.includes(host)).toBe(false);
    }
    expect(browserSource.includes("eval(")).toBe(false);
    expect(browserSource.includes("new Function")).toBe(false);
  });

  it("copies _headers into the build output", () => {
    const outDir = mkdtempSync(join(tmpdir(), "argonova-headers-"));
    try {
      execFileSync(
        join(ROOT, "node_modules", ".bin", "vite"),
        ["build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"],
        { cwd: ROOT, timeout: 120_000, encoding: "utf8" },
      );
      const builtHeaders = readText(join(outDir, "_headers"));
      expect(builtHeaders).toBe(readText(join(ROOT, "public/_headers")));
      expectHeaders(builtHeaders);

      const builtHtml = readText(join(outDir, "index.html"));
      const builtUrls = [...builtHtml.matchAll(/https?:\/\/[^"'>\s]+/g)].map((match) => match[0]);
      const builtHosts = new Set(builtUrls.map((url) => new URL(url).host));
      expect([...builtHosts].sort()).toEqual(
        ["argonova.pages.dev", "fonts.googleapis.com", "fonts.gstatic.com"].sort(),
      );
      expect(builtHtml.includes("<iframe")).toBe(false);

      const bundled = readdirSync(join(outDir, "assets"))
        .filter((name) => name.endsWith(".js") || name.endsWith(".css"))
        .map((name) => readText(join(outDir, "assets", name)))
        .join("\n");
      expect(bundled).toContain("textures/earth-day.jpg");
      expect(bundled).toContain("textures/earth-night.jpg");
      expect(bundled).toContain("data/");
      for (const host of ["unpkg.com", "jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com"]) {
        expect(bundled.includes(host)).toBe(false);
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);
});
