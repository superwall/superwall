import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { flushUpdateCheck, isNewerVersion, maybeNotifyUpdate, refreshUpdateCheck } from "@/core/support/upgrade";
import { command as upgrade } from "@/commands/support/upgrade";
import { VERSION } from "@/environment";
import { restoreBin, useBin } from "../../helpers/bin";
import { runCommand } from "../../helpers/command";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";

const REGISTRY = "registry.npmjs.org/superwall/latest";
const testContext = process.env.NODE_TEST_CONTEXT;

afterEach(() => {
  if (testContext === undefined) delete process.env.NODE_TEST_CONTEXT;
  else process.env.NODE_TEST_CONTEXT = testContext;
  restoreFetch();
  restoreBin();
  clearHomes();
  process.exitCode = 0;
});

function writeCheck(home: string, updateCheck: { latest?: string; checkedAt?: string }): void {
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ updateCheck }));
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
