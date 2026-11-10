import { mkdir, writeFile } from "node:fs/promises";

const dataDir = new URL("../public/data/", import.meta.url);
const emptyJson = `${JSON.stringify({}, null, 2)}\n`;

await mkdir(dataDir, { recursive: true });

await Promise.all([
  writeFile(new URL("tle.json", dataDir), emptyJson),
  writeFile(new URL("launches.json", dataDir), emptyJson),
]);
