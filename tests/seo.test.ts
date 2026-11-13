import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { LANGUAGE_STORAGE_KEY } from "../src/i18n";

declare const process: {
  cwd(): string;
};

const DESCRIPTION = "선택한 위치의 밤하늘과 위성 위치, 로켓 발사 시각.";
const SITE = "https://argonova.pages.dev";
const ROOT = process.cwd();

function readText(path: string): string {
  return new TextDecoder().decode(readFileSync(path));
}

function tags(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((match) => match[0]);
}

function attribute(tag: string, name: string): string {
  return new RegExp(`${name}=["']([^"']*)["']`, "i").exec(tag)?.[1] ?? "";
}

function metaContents(html: string, attr: "name" | "property", key: string): string[] {
  return tags(html, "meta")
    .filter((tag) => attribute(tag, attr) === key)
    .map((tag) => attribute(tag, "content"));
}

function jsonLdBlocks(html: string): string[] {
  return [
    ...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ].map((match) => match[1] ?? "");
}

function expectSearchDocument(html: string): void {
  expect(metaContents(html, "property", "og:locale")).toEqual(["ko_KR"]);
  expect(metaContents(html, "name", "description")).toEqual([DESCRIPTION]);
  expect(metaContents(html, "property", "og:description")).toEqual([DESCRIPTION]);
  expect(metaContents(html, "property", "og:url")).toEqual([SITE]);
  expect(html.toLowerCase().includes("hreflang")).toBe(false);

  const canonical = tags(html, "link").filter((tag) => attribute(tag, "rel") === "canonical");
  expect(canonical).toHaveLength(1);
  expect(attribute(canonical[0] ?? "", "href")).toBe(SITE);
  expect(attribute(canonical[0] ?? "", "href").endsWith("/")).toBe(false);

  const blocks = jsonLdBlocks(html);
  expect(blocks).toHaveLength(1);
  const data = JSON.parse(blocks[0] ?? "") as {
    "@context": string;
    "@type": string;
    name: string;
    url: string;
    description: string;
  };
  expect(data["@context"]).toBe("https://schema.org");
  expect(data["@type"]).toBe("WebSite");
  expect(data.name).toBe("Argonova");
  expect(data.url).toBe(SITE);
  expect(data.description).toBe(DESCRIPTION);
  expect(data.url.includes(DESCRIPTION)).toBe(false);
  expect(data.description).not.toMatch(/\b(night sky|rocket launch)\b/i);
}

const added: Node[] = [];

afterEach(() => {
  for (const node of added) {
    node.parentNode?.removeChild(node);
  }
  added.length = 0;
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("search documents", () => {
  it("publishes robots, sitemap, canonical, and Korean JSON-LD", () => {
    const robots = readText(join(ROOT, "public/robots.txt"));
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);

    const sitemap = readText(join(ROOT, "public/sitemap.xml"));
    const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
    expect(locs).toEqual([SITE]);
    expect(sitemap.includes("lastmod")).toBe(false);

    const html = readText(join(ROOT, "index.html"));
    expectSearchDocument(html);
    expect(metaContents(html, "property", "og:url")[0]).toBe(locs[0]);

    const headers = readText(join(ROOT, "public/_headers"));
    const csp = headers
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("Content-Security-Policy:"));
    const scriptSrc = csp
      ?.slice("Content-Security-Policy:".length)
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("script-src"));
    expect(scriptSrc).toBe("script-src 'self'");
    expect(scriptSrc?.includes("unsafe-inline")).toBe(false);
  });

  it("copies robots and sitemap into the build and keeps the Korean description", () => {
    const outDir = mkdtempSync(join(tmpdir(), "argonova-seo-"));
    try {
      execFileSync(
        join(ROOT, "node_modules", ".bin", "vite"),
        ["build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"],
        { cwd: ROOT, timeout: 120_000, encoding: "utf8" },
      );
      const robots = readText(join(outDir, "robots.txt"));
      expect(robots).toContain("User-agent: *");
      expect(robots).toContain("Allow: /");
      expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);

      const sitemap = readText(join(outDir, "sitemap.xml"));
      const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
      expect(locs).toEqual([SITE]);
      expect(sitemap.includes("lastmod")).toBe(false);

      const html = readText(join(outDir, "index.html"));
      expectSearchDocument(html);
      expect(metaContents(html, "property", "og:url")[0]).toBe(locs[0]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("search metadata while the language changes", () => {
  function installHead(): void {
    const description = document.createElement("meta");
    description.name = "description";
    description.content = DESCRIPTION;

    const ogDescription = document.createElement("meta");
    ogDescription.setAttribute("property", "og:description");
    ogDescription.content = DESCRIPTION;

    const ogUrl = document.createElement("meta");
    ogUrl.setAttribute("property", "og:url");
    ogUrl.content = SITE;

    const ogLocale = document.createElement("meta");
    ogLocale.setAttribute("property", "og:locale");
    ogLocale.content = "ko_KR";

    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = SITE;

    const jsonLd = document.createElement("script");
    jsonLd.type = "application/ld+json";
    jsonLd.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Argonova",
      url: SITE,
      description: DESCRIPTION,
    });

    const nodes = [description, ogDescription, ogUrl, ogLocale, canonical, jsonLd];
    document.head.append(...nodes);
    added.push(...nodes);
  }

  function frozenMarkup(): {
    description: string | null;
    ogDescription: string | null;
    ogUrl: string | null;
    canonical: string | null;
    jsonLd: string | null;
  } {
    return {
      description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? null,
      ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute("content") ?? null,
      ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute("content") ?? null,
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
      jsonLd: document.querySelector('script[type="application/ld+json"]')?.textContent ?? null,
    };
  }

  it("changes only og:locale when the screen switches to English and back", () => {
    installHead();
    const before = frozenMarkup();
    document.body.append(createApp({ now: () => new Date("2026-11-12T12:00:00.000Z") }));
    expect(document.querySelector('meta[property="og:locale"]')?.getAttribute("content")).toBe("ko_KR");
    expect(frozenMarkup()).toEqual(before);

    document.querySelector<HTMLButtonElement>("#language-button")?.click();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.querySelector("h1")?.textContent).toBe("11/12 (Thu)");
    expect(document.querySelector('meta[property="og:locale"]')?.getAttribute("content")).toBe("en_US");
    expect(frozenMarkup()).toEqual(before);

    document.querySelector<HTMLButtonElement>("#language-button")?.click();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("ko");
    expect(document.querySelector("h1")?.textContent).toBe("11월 12일 (목)");
    expect(document.querySelector('meta[property="og:locale"]')?.getAttribute("content")).toBe("ko_KR");
    expect(frozenMarkup()).toEqual(before);
    expect(document.querySelector('link[rel="alternate"]')).toBeNull();
  });
});
