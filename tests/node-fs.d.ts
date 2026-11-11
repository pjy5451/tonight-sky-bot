declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { size: number };
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}

declare module "node:child_process" {
  export function execFileSync(
    file: string,
    args: readonly string[],
    options?: { cwd?: string; timeout?: number; encoding?: "utf8" },
  ): string;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
}
