import assert from "node:assert/strict";
import { test } from "node:test";
import { assertBuilderAccepts, KNOWN_WRANGLER_KEYS, outsideRepoProblem, workerInputsOutside } from "@/core/workspaces/wrangler-config";
import { WorkspaceError } from "@/core/workspaces/project";

const VALID = { configPath: "/x/wrangler.jsonc", main: "src/worker.ts", compatibility_date: "2026-09-01" };

const refuses = (config: unknown, message: RegExp) =>
  assert.throws(() => assertBuilderAccepts(config), (error: Error) => {
    assert.ok(error instanceof WorkspaceError);
    assert.match(error.message, /^This would fail on the builder\. /);
    assert.match(error.message, message);
    return true;
  });

test("what the starter declares passes, and empty defaults aren't declarations", () => {
  assert.doesNotThrow(() => assertBuilderAccepts(VALID));
  assert.doesNotThrow(() =>
    assertBuilderAccepts({
      ...VALID,
      vars: {},
      kv_namespaces: [],
      site: undefined,
      rules: [],
      no_bundle: false,
      name: "",
      triggers: { crons: [] },
      build: { command: "", cwd: "./" },
      future_setting: { nested: [], off: false, none: null },
    }),
  );
});

test("the keys the builder now refuses are refused, each with why", () => {
  for (const key of ["site", "addresses", "access", "cache", "previews", "first_party_worker", "pages_build_output_dir"]) {
    refuses({ ...VALID, [key]: { a: "b" } }, new RegExp(`these Worker settings don't apply.*found: ${key}`));
  }
  refuses({ ...VALID, analytics: { enabled: true } }, /Bindings are not supported.*found: analytics/);
  refuses({ ...VALID, definedEnvironments: ["staging"] }, /no `env` section.*found: definedEnvironments/);
  refuses({ ...VALID, targetEnvironment: "staging" }, /found: targetEnvironment/);
  refuses({ ...VALID, durable_objects: { bindings: [{ name: "D" }] } }, /Durable Objects/);
  refuses({ ...VALID, workflows: [{ name: "w" }] }, /Workflows/);
  refuses({ ...VALID, containers: [{ name: "c" }] }, /Containers/);
  refuses({ ...VALID, vars: { A: "b" }, secrets: ["S"] }, /found: vars, secrets/);
  refuses({ ...VALID, no_bundle: true }, /one bundled module/);
});

test("an unknown key that's set fails closed, and one that's empty doesn't", () => {
  refuses({ ...VALID, brand_new_binding: [{ name: "x" }] }, /keys the builder doesn't support \(found: brand_new_binding\)/);
  assert.ok(!KNOWN_WRANGLER_KEYS.has("brand_new_binding"));
});

test("the rest of the config's rules", () => {
  refuses(null, /No wrangler config/);
  refuses([], /No wrangler config/);
  refuses({ ...VALID, triggers: { crons: ["0 9 * * *"] } }, /Cron triggers belong in superwall\.json/);
  refuses({ ...VALID, build: { command: "make" } }, /Custom build commands/);
  refuses({ ...VALID, main: "" }, /needs a `main`/);
  refuses({ ...VALID, compatibility_date: "soon" }, /needs a compatibility_date/);
  refuses({ configPath: "x", main: "a" }, /needs a compatibility_date/);
});

test("inputs outside the repo: its parents, absolute paths and its git metadata, but not the toolchain", () => {
  const inputs = ["src/worker.ts", "../secret.js", "/etc/passwd", ".git/config", "..", ".git", "../node_modules/wrangler/x.js", ".github/a.js", "..x/y.js"];
  assert.deepEqual(workerInputsOutside(inputs, (input) => input.includes("node_modules/wrangler")), ["../secret.js", "/etc/passwd", ".git/config", "..", ".git"]);
});

test("the message caps what it lists, and no inputs is no problem", () => {
  assert.equal(outsideRepoProblem([]), undefined);
  assert.match(outsideRepoProblem(["a", "b"])!, /isn't allowed: a, b\.$/);
  assert.match(outsideRepoProblem(["a", "b", "c", "d", "e", "f", "g"])!, /a, b, c, d, e and 2 more\.$/);
});
