import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { command as upgrade } from "@/commands/support/upgrade";
import { VERSION } from "@/environment";
import { restoreBin, useBin } from "../../helpers/bin";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";
import { runCommand } from "../../helpers/command";

const REGISTRY = "registry.npmjs.org";
const GITHUB_HEAD = "api.github.com/repos/superwall/skills/commits/next";
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

test("running through npx has no CLI to upgrade, but still installs the skills", async () => {
  runningVia("/Users/dev/.npm/_npx/abc/node_modules/.bin/superwall");
  useHome();
  useFetch([{ match: GITHUB_HEAD, body: { sha: "abc" } }]);
  useBin({ npx: "exit 0", git: "exit 1" });

  const result = await runCommand(upgrade);

  assert.match(result.said("info").join(), /npx, which always fetches the latest/);
  assert.deepEqual(result.said("spinner.stop"), ["Superwall skills updated"]);

  const asJson = await runCommand(upgrade, { json: true });
  assert.deepEqual(asJson.json, { upgraded: false, via: "npx", skills: "current" });
});

test("says nothing to do when the installed version is the latest", async () => {
  useHome();
  useFetch([
    { match: REGISTRY, body: { version: VERSION } },
    { match: GITHUB_HEAD, body: { sha: "abc" } },
  ]);
  useBin({ npx: "exit 0", git: "exit 1" });

  const result = await runCommand(upgrade);

  assert.match(result.said("spinner.stop").join(), new RegExp(`latest version`));

  const asJson = await runCommand(upgrade, { json: true });
  assert.deepEqual(asJson.json, { upgraded: false, version: VERSION, skills: "current" });
});

test("an unreachable registry is an error, not a silent no-op", async () => {
  useHome();
  useFetch([{ match: REGISTRY, fail: true }]);

  const result = await runCommand(upgrade);

  assert.match(result.said("error").join(), /Couldn't reach the npm registry/);
  assert.equal(process.exitCode, 1);
});

test("installs the newer version globally, then its skills", async () => {
  useHome();
  useFetch([{ match: REGISTRY, body: { version: "99.0.0" } }]);
  const bin = useBin({ npm: 'if [ "$1" = prefix ]; then dirname "$0"; fi' });
  fs.mkdirSync(path.join(bin, "bin"));
  fs.writeFileSync(
    path.join(bin, "bin", "superwall"),
    `#!${process.execPath}\nconst fs = require("fs"), file = process.env.SUPERWALL_HOME + "/config.json";\nfs.writeFileSync(file, JSON.stringify({ skillsSync: { cliVersion: "99.0.0", syncedAt: new Date().toISOString() } }));\n`,
  );
  fs.chmodSync(path.join(bin, "bin", "superwall"), 0o755);

  const result = await runCommand(upgrade, { json: true });

  assert.deepEqual(result.json, { upgraded: true, from: VERSION, to: "99.0.0", skills: "updated" });
});

test("a failed install reports what npm said", async () => {
  useHome();
  useFetch([{ match: REGISTRY, body: { version: "99.0.0" } }]);
  useBin({ npm: "echo 'EACCES: permission denied' >&2; exit 1" });

  const result = await runCommand(upgrade);

  const said = result.said("error").join();
  assert.match(said, /npm couldn't upgrade the package/);
  assert.match(said, /EACCES/);
  assert.equal(process.exitCode, 1);
});
