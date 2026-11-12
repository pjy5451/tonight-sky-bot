import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

declare const process: {
  cwd(): string;
};

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const TEXT_EXT = new Set([
  ".ts",
  ".js",
  ".mjs",
  ".css",
  ".html",
  ".md",
  ".json",
  ".webmanifest",
  ".svg",
  ".yml",
  ".txt",
]);

function readText(path: string): string {
  return new TextDecoder().decode(readFileSync(path));
}

function relative(path: string): string {
  const prefix = ROOT.endsWith("/") ? ROOT : `${ROOT}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function isDataPath(path: string): boolean {
  const rel = relative(path);
  return rel === "public/data" || rel.startsWith("public/data/");
}

function listDir(path: string): string[] | null {
  try {
    return readdirSync(path);
  } catch {
    return null;
  }
}

function walk(dir: string, out: string[]): void {
  const names = listDir(dir);
  if (!names) {
    return;
  }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) {
      continue;
    }
    const path = join(dir, name);
    if (isDataPath(path)) {
      continue;
    }
    const children = listDir(path);
    if (children) {
      walk(path, out);
      continue;
    }
    const dot = name.lastIndexOf(".");
    const ext = dot >= 0 ? name.slice(dot) : "";
    if (TEXT_EXT.has(ext)) {
      out.push(path);
    }
  }
}

function filesContaining(needle: string): string[] {
  const files: string[] = [];
  walk(ROOT, files);
  return files
    .filter((file) => readText(file).includes(needle))
    .map((file) => relative(file))
    .sort();
}

describe("banned slogans", () => {
  it("keeps the banned phrases only in the DESIGN.md prohibition", () => {
    const explore = "탐" + "험";
    const blurb = ["하늘", "위성", "발사 일정"].join(", ");
    expect(filesContaining(explore)).toEqual(["DESIGN.md"]);
    expect(filesContaining(blurb)).toEqual(["DESIGN.md"]);

    const design = readText(join(ROOT, "DESIGN.md"));
    const exploreLines = design.split("\n").filter((line) => line.includes(explore));
    const blurbLines = design.split("\n").filter((line) => line.includes(blurb));
    expect(exploreLines).toHaveLength(1);
    expect(blurbLines).toHaveLength(1);
    expect(exploreLines[0]).toContain("만들지 않는다");
    expect(blurbLines[0]).toContain("만들지 않는다");
  });
});
