declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
  export function statSync(path: string): { size: number };
}
