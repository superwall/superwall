import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  flushUpdateCheck,
  isGlobalInstall,
  isNewerVersion,
  maybeNotifyUpdate,
  printAutoUpdate,
  recordAutoUpdate,
  refreshUpdateCheck,
  selectAutoUpdate,
} from "@/core/support/upgrade";
import { command as upgrade } from "@/commands/support/upgrade";
import { VERSION } from "@/environment";
import { restoreBin, useBin } from "../../helpers/bin";
import { runCommand } from "../../helpers/command";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";

const REGISTRY = "registry.npmjs.org/superwall/latest";
const testContext = process.env.NODE_TEST_CONTEXT;
const saved = { off: process.env.SUPERWALL_NO_UPDATE, ci: process.env.CI, target: process.env.SW_AUTO_UPDATE };

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  restoreEnv("NODE_TEST_CONTEXT", testContext);
  restoreEnv("SUPERWALL_NO_UPDATE", saved.off);
  restoreEnv("CI", saved.ci);
  restoreEnv("SW_AUTO_UPDATE", saved.target);
  restoreFetch();
  restoreBin();
  clearHomes();
  process.exitCode = 0;
});

const [MAJOR, MINOR, PATCH] = VERSION.split(".").map((part) => parseInt(part, 10)) as [number, number, number];
const MINOR_BUMP = `${MAJOR}.${MINOR + 1}.0`;
const PATCH_BUMP = `${MAJOR}.${MINOR}.${PATCH + 1}`;
const MAJOR_BUMP = `${MAJOR + 1}.0.0`;

function writeCheck(home: string, updateCheck: { latest?: string; checkedAt?: string }): void {
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ updateCheck }));
}

function writeConfig(home: string, config: Record<string, unknown>): void {
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify(config));
}

function readConfig(home: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")) as Record<string, unknown>;
}

function autoUpdating(): void {
  delete process.env.NODE_TEST_CONTEXT;
  delete process.env.SUPERWALL_NO_UPDATE;
  delete process.env.CI;
}

function globalInstall(): { bin: string; entry: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-global-"));
  const entry = path.join(root, "superwall", "bin", "superwall.js");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "");
  const bin = useBin({
    npm: `if [ "$1" = root ]; then echo "${root}"; else echo "$@" > "$(dirname "$0")/args"; fi`,
  });
  return { bin, entry };
}

function readCheck(home: string): unknown {
  const file = path.join(home, "config.json");
  if (!fs.existsSync(file)) return undefined;
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { updateCheck?: unknown }).updateCheck;
}

function recordStream(): { write(chunk: string): boolean; written: string[] } {
  const written: string[] = [];
  return {
    written,
    write: (chunk) => {
      written.push(chunk);
      return true;
    },
  };
}

test("version comparison handles major, minor, patch, and garbage", () => {
  assert.equal(isNewerVersion("1.0.1", "1.0.0"), true);
  assert.equal(isNewerVersion("1.1.0", "1.0.9"), true);
  assert.equal(isNewerVersion("2.0.0", "1.9.9"), true);
  assert.equal(isNewerVersion("1.0.0", "1.0.0"), false);
  assert.equal(isNewerVersion("1.0.0", "1.0.1"), false);
  assert.equal(isNewerVersion("0.9.9", "1.0.0"), false);
  assert.equal(isNewerVersion("garbage", "1.0.0"), false);
  assert.equal(isNewerVersion("1.0.0", "garbage"), false);
  assert.equal(isNewerVersion("1.2", "1.1.9"), true);
  assert.equal(isNewerVersion("1.2.0", "1.2"), false);
  assert.equal(isNewerVersion("1.2.1", "1.2"), true);
  assert.equal(isNewerVersion("1.2", "1.2.1"), false);
});

test("flushing with no check in flight returns at once", async () => {
  const start = Date.now();
  await flushUpdateCheck(2000);
  assert.ok(Date.now() - start < 100);
});

test("a newer cached release prints one dim upgrade hint", () => {
  const home = useHome();
  writeCheck(home, { latest: "99.0.0", checkedAt: new Date().toISOString() });
  const stream = recordStream();

  maybeNotifyUpdate(stream);

  assert.equal(stream.written.length, 1);
  assert.match(stream.written[0]!, new RegExp(`Update available ${VERSION} → 99\\.0\\.0`));
  assert.match(stream.written[0]!, /superwall upgrade/);
});

test("no hint without a cached check or when the cache isn't newer", () => {
  useHome();
  const empty = recordStream();
  maybeNotifyUpdate(empty);

  const home = useHome();
  writeCheck(home, { latest: VERSION, checkedAt: new Date().toISOString() });
  const current = recordStream();
  maybeNotifyUpdate(current);

  assert.deepEqual(empty.written, []);
  assert.deepEqual(current.written, []);
});

test("test runs never check the registry", async () => {
  const home = useHome();
  const log = useFetch([{ match: REGISTRY, body: { version: "99.0.0" } }]);

  refreshUpdateCheck();
  await flushUpdateCheck(1000);

  assert.equal(log.length, 0);
  assert.equal(readCheck(home), undefined);
});

test("a stale check asks the registry and records the latest version", async () => {
  const home = useHome();
  writeCheck(home, { latest: "0.0.1", checkedAt: "2000-01-01T00:00:00.000Z" });
  delete process.env.NODE_TEST_CONTEXT;
  const log = useFetch([{ match: REGISTRY, body: { version: "99.0.0" } }]);

  refreshUpdateCheck();
  await flushUpdateCheck(1000);

  assert.equal(log.length, 1);
  assert.equal(log[0]!.url, "https://registry.npmjs.org/superwall/latest");
  const check = readCheck(home) as { latest: string; checkedAt: string };
  assert.equal(check.latest, "99.0.0");
  assert.ok(Date.now() - Date.parse(check.checkedAt) < 60_000);
});

test("a check from the last day is reused without asking the registry", async () => {
  const home = useHome();
  const checkedAt = new Date().toISOString();
  writeCheck(home, { latest: "1.0.0", checkedAt });
  delete process.env.NODE_TEST_CONTEXT;
  const log = useFetch([{ match: REGISTRY, body: { version: "99.0.0" } }]);

  refreshUpdateCheck();
  await flushUpdateCheck(1000);

  assert.equal(log.length, 0);
  assert.deepEqual(readCheck(home), { latest: "1.0.0", checkedAt });
});

test("a failing or versionless registry answer leaves the cache untouched", async () => {
  const home = useHome();
  delete process.env.NODE_TEST_CONTEXT;

  useFetch([{ match: REGISTRY, status: 503, body: {} }]);
  refreshUpdateCheck();
  await flushUpdateCheck(1000);

  useFetch([{ match: REGISTRY, body: {} }]);
  refreshUpdateCheck();
  await flushUpdateCheck(1000);

  assert.equal(readCheck(home), undefined);
});

test("an upgrade installs the release, records it as checked and ends on the latest version", async () => {
  const home = useHome();
  useFetch([{ match: REGISTRY, body: { version: "99.0.0" } }]);
  const bin = useBin({ npm: 'echo "$@" > "$(dirname "$0")/args"; echo "added 1 package"' });

  const result = await runCommand(upgrade);

  assert.equal(fs.readFileSync(path.join(bin, "args"), "utf8").trim(), "install --global superwall@99.0.0");
  assert.match(result.said("spinner.stop").join(), new RegExp(`Upgraded \`${VERSION}\` → \`99\.0\.0\``));
  assert.deepEqual(result.said("outro"), ["You're on the latest version."]);
  assert.equal((readCheck(home) as { latest: string }).latest, "99.0.0");
});

test("a failed install with nothing on stderr still points at the manual command", async () => {
  const home = useHome();
  useFetch([{ match: REGISTRY, body: { version: "99.0.0" } }]);
  useBin({ npm: "exit 1" });

  const result = await runCommand(upgrade);

  assert.deepEqual(result.said("error"), [
    "npm couldn't upgrade the package. Try: npm install --global superwall@latest",
  ]);
  assert.equal(process.exitCode, 1);
  assert.equal(readCheck(home), undefined);
});

test("a newer minor or patch release in the cache is due for an automatic update", () => {
  const home = useHome();
  autoUpdating();

  writeCheck(home, { latest: MINOR_BUMP, checkedAt: new Date().toISOString() });
  assert.equal(selectAutoUpdate(), MINOR_BUMP);

  writeCheck(home, { latest: PATCH_BUMP, checkedAt: new Date().toISOString() });
  assert.equal(selectAutoUpdate(), PATCH_BUMP);
});

test("a major release, the current version or no cache never updates on its own", () => {
  const home = useHome();
  autoUpdating();
  assert.equal(selectAutoUpdate(), null);

  writeCheck(home, { latest: MAJOR_BUMP, checkedAt: new Date().toISOString() });
  assert.equal(selectAutoUpdate(), null);

  writeCheck(home, { latest: VERSION, checkedAt: new Date().toISOString() });
  assert.equal(selectAutoUpdate(), null);
});

test("the switch, CI and test runs turn the automatic update off", () => {
  const home = useHome();
  writeCheck(home, { latest: MINOR_BUMP, checkedAt: new Date().toISOString() });
  assert.equal(selectAutoUpdate(), null);

  autoUpdating();
  process.env.SUPERWALL_NO_UPDATE = "1";
  assert.equal(selectAutoUpdate(), null);

  delete process.env.SUPERWALL_NO_UPDATE;
  process.env.CI = "true";
  assert.equal(selectAutoUpdate(), null);
});

test("a release already being installed is not started again for a day", () => {
  const home = useHome();
  autoUpdating();
  const updateCheck = { latest: MINOR_BUMP, checkedAt: new Date().toISOString() };

  writeCheck(home, updateCheck);
  recordAutoUpdate(MINOR_BUMP);
  const recorded = readConfig(home).autoUpdate as { version: string; startedAt: string };
  assert.equal(recorded.version, MINOR_BUMP);
  assert.ok(Date.now() - Date.parse(recorded.startedAt) < 60_000);
  assert.equal(selectAutoUpdate(), null);

  writeConfig(home, { updateCheck, autoUpdate: { version: MINOR_BUMP, startedAt: "2000-01-01T00:00:00.000Z" } });
  assert.equal(selectAutoUpdate(), MINOR_BUMP);

  writeConfig(home, { updateCheck, autoUpdate: { version: PATCH_BUMP, startedAt: new Date().toISOString() } });
  assert.equal(selectAutoUpdate(), MINOR_BUMP);
});

test("a started update says so in one dim line", () => {
  const stream = recordStream();

  printAutoUpdate(stream, MINOR_BUMP);

  assert.deepEqual(stream.written, [`Updating ${VERSION} → ${MINOR_BUMP} in the background\n`]);
});

test("an automatic update installs the version it was given, without asking the registry", async () => {
  const home = useHome();
  const log = useFetch([]);
  const install = globalInstall();
  process.env.SW_AUTO_UPDATE = MINOR_BUMP;

  const result = await runCommand(upgrade, { json: true });

  assert.equal(log.length, 0);
  assert.equal(fs.readFileSync(path.join(install.bin, "args"), "utf8").trim(), `install --global superwall@${MINOR_BUMP}`);
  assert.deepEqual(result.json, { upgraded: true, from: VERSION, to: MINOR_BUMP });
  assert.equal((readCheck(home) as { latest: string }).latest, MINOR_BUMP);
});

test("only the CLI npm installed globally counts as a global install", () => {
  const install = globalInstall();

  assert.equal(isGlobalInstall(install.entry), true);
  assert.equal(isGlobalInstall(path.join(os.tmpdir(), "project", "node_modules", "superwall", "bin", "superwall.js")), false);
  assert.equal(isGlobalInstall(), false);
});

test("an npm that can't name its global root means no global install", () => {
  const install = globalInstall();
  useBin({ npm: "exit 1" });
  assert.equal(isGlobalInstall(install.entry), false);

  useBin({ npm: "true" });
  assert.equal(isGlobalInstall(install.entry), false);
});

test("an automatic update to a version that isn't newer does nothing", async () => {
  useHome();
  const install = globalInstall();
  process.env.SW_AUTO_UPDATE = VERSION;

  const result = await runCommand(upgrade, { json: true });

  assert.equal(fs.existsSync(path.join(install.bin, "args")), false);
  assert.deepEqual(result.json, { upgraded: false, version: VERSION });
});
