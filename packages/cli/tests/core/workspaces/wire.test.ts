import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as wire from "@/core/workspaces/wire";

const STARTER = fileURLToPath(new URL("../../../../../workspaces/starter/", import.meta.url));
const readStarter = (file: string) => JSON.parse(fs.readFileSync(path.join(STARTER, file), "utf8"));

test("the CLI's wire constants match the SDK it hands out", async () => {
  const constants = await import(pathToFileURL(path.join(STARTER, "vendor/workspace-sdk/constants.mjs")).href);
  for (const name of [
    "CONTEXT_HEADER",
    "ENTRYPOINT_HEADER",
    "TRIGGER_HEADER",
    "API_HOST",
    "PLATFORM_HOST",
    "BRIDGE_PROTOCOL",
    "MOUNT_LOAD_TIMEOUT_MS",
    "WORKSPACE_COMPATIBILITY_DATE",
    "METRIC_LIMITS",
    "READOUT_LIMITS",
  ] as const) {
    assert.deepEqual(wire[name], constants[name], name);
  }
  for (const pathname of ["/__sw", "/__SW/x", "//__sw/x", "/%5F%5Fsw/x", "/%E0", "/ok", "/__swish"]) {
    assert.equal(wire.isInternalPath(pathname), constants.isInternalPath(pathname), pathname);
  }
});

test("the starter satisfies the builder's rules", () => {
  const manifest = readStarter("package.json");
  assert.equal(manifest.dependencies["@superwall/workspace-sdk"], "file:vendor/workspace-sdk");
  const lock = readStarter("package-lock.json");
  assert.equal(lock.lockfileVersion, 3);
  const sdk = lock.packages["node_modules/@superwall/workspace-sdk"];
  assert.deepEqual(sdk, { resolved: "vendor/workspace-sdk", link: true });
  for (const [key, entry] of Object.entries<Record<string, unknown>>(lock.packages)) {
    if (!key.includes("node_modules/") || entry.link || entry.inBundle) continue;
    assert.match(String(entry.resolved), /^https:\/\/registry\.npmjs\.org\//, key);
    assert.ok(entry.integrity, `${key} has no integrity`);
  }
  assert.equal(lock.packages["vendor/workspace-sdk"].version, readStarter("vendor/workspace-sdk/package.json").version);
  const wrangler = fs.readFileSync(path.join(STARTER, "wrangler.jsonc"), "utf8");
  assert.match(wrangler, new RegExp(`"compatibility_date": "${wire.WORKSPACE_COMPATIBILITY_DATE}"`));
  assert.match(wrangler, /"main": "src\/worker.ts"/);
});

test("the starter's slots are ones the CLI knows", async () => {
  const { SLOTS } = await import("@/core/workspaces/slots");
  for (const entrypoint of readStarter("superwall.json").entrypoints) {
    assert.ok(SLOTS[entrypoint.slot], entrypoint.slot);
  }
});
