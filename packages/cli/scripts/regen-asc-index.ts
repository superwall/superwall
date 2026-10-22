import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAscIndex } from "../src/core/app-store-connect/api/spec";

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "tests",
  "fixtures",
  "asc-index.json",
);

const index = await downloadAscIndex();
delete index.fetchedAt;
writeFileSync(OUT, JSON.stringify(index));
const ops = Object.values(index.paths).reduce((n, ms) => n + Object.keys(ms).length, 0);
console.log(
  `tests/fixtures/asc-index.json: spec ${index.specVersion}, ${Object.keys(index.paths).length} paths, ${ops} operations`,
);
