import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

const atLeast = (version: string, floor: [number, number, number]) => {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < floor.length; index++) {
    const have = parts[index] ?? 0;
    if (have !== floor[index]) return have > floor[index]!;
  }
  return true;
};

describe("dependencies", () => {
  it("resolves a zod outside GHSA-mrhx-c7xc-m3w5 (fixed in 4.6.6)", () => {
    const { version } = require("zod/package.json") as { version: string };
    expect(atLeast(version, [4, 6, 6]), `zod ${version}`).toBe(true);
  });
});
