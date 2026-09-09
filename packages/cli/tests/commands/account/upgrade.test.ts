import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { runUpgrade } from "@/commands/account/upgrade";
import { VERSION } from "@/environment";
import { restoreBin, useBin } from "../../helpers/bin";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";
import { run } from "../../helpers/command";

const REGISTRY = "registry.npmjs.org";
let entry: string | undefined;

afterEach(() => {
  restoreFetch();
  restoreBin();
  clearHomes();
  if (entry !== undefined) process.argv[1] = entry;
  entry = undefined;
  process.exitCode = undefined;
});

function runningVia(path: string): void {
  entry = process.argv[1];
  process.argv[1] = path;
}

test("running through npx has nothing to upgrade", async () => {
  runningVia("/Users/dev/.npm/_npx/abc/node_modules/.bin/superwall");

  const result = await run(runUpgrade.definition);

  assert.match(result.said("info").join(), /npx, which always fetches the latest/);

  const asJson = await run(runUpgrade.definition, { argv: { json: true } });
  assert.deepEqual(asJson.json, { upgraded: false, via: "npx" });
});

test("says nothing to do when the installed version is the latest", async () => {
  useHome();
  useFetch([{ match: REGISTRY, body: { version: VERSION } }]);

  const result = await run(runUpgrade.definition);

  assert.match(result.said("spinner.stop").join(), new RegExp(`latest version`));

  useFetch([{ match: REGISTRY, body: { version: VERSION } }]);
  const asJson = await run(runUpgrade.definition, { argv: { json: true } });
  assert.deepEqual(asJson.json, { upgraded: false, version: VERSION });
});

test("an unreachable registry is an error, not a silent no-op", async () => {
  useHome();
  useFetch([{ match: REGISTRY, fail: true }]);

  const result = await run(runUpgrade.definition);

  assert.match(result.said("error").join(), /Couldn't reach the npm registry/);
  assert.equal(process.exitCode, 1);
});

test("installs the newer version globally and records the check", async () => {
  useHome();
  useFetch([{ match: REGISTRY, body: { version: "99.0.0" } }]);
  useBin({ npm: "exit 0" });

  const result = await run(runUpgrade.definition, { argv: { json: true } });

  assert.deepEqual(result.json, { upgraded: true, from: VERSION, to: "99.0.0" });
});

test("a failed install reports what npm said", async () => {
  useHome();
  useFetch([{ match: REGISTRY, body: { version: "99.0.0" } }]);
  useBin({ npm: "echo 'EACCES: permission denied' >&2; exit 1" });

  const result = await run(runUpgrade.definition);

  const said = result.said("error").join();
  assert.match(said, /npm couldn't upgrade the package/);
  assert.match(said, /EACCES/);
  assert.equal(process.exitCode, 1);
});
