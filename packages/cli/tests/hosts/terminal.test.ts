import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { finishTerminal, startAutoUpdate } from "@/hosts/terminal";
import { VERSION } from "@/environment";
import { clearHomes, useHome } from "../helpers/home";

const [MAJOR, MINOR] = VERSION.split(".").map((part) => parseInt(part, 10)) as [number, number];
const MINOR_BUMP = `${MAJOR}.${MINOR + 1}.0`;
const MAJOR_BUMP = `${MAJOR + 1}.0.0`;
const saved = { context: process.env.NODE_TEST_CONTEXT, off: process.env.SUPERWALL_NO_UPDATE, ci: process.env.CI };
const entry = process.argv[1];

afterEach(() => {
  for (const [key, value] of [
    ["NODE_TEST_CONTEXT", saved.context],
    ["SUPERWALL_NO_UPDATE", saved.off],
    ["CI", saved.ci],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  process.argv[1] = entry ?? "";
  clearHomes();
});

function fakeSpawn(calls: { cmd: string; args: readonly string[]; options: Record<string, unknown> }[]) {
  let unrefs = 0;
  const impl = ((cmd: string, args: readonly string[], options: Record<string, unknown>) => {
    calls.push({ cmd, args, options });
    return Object.assign(new EventEmitter(), { unref: () => void unrefs++ });
  }) as unknown as typeof spawn;
  return { impl, unrefs: () => unrefs };
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

function cached(home: string, latest: string): void {
  fs.writeFileSync(
    path.join(home, "config.json"),
    JSON.stringify({ updateCheck: { latest, checkedAt: new Date().toISOString() } }),
  );
  delete process.env.NODE_TEST_CONTEXT;
  delete process.env.SUPERWALL_NO_UPDATE;
  delete process.env.CI;
}

function starter() {
  const started: string[] = [];
  return {
    started,
    start: (version: string) => {
      started.push(version);
      return true;
    },
  };
}

test("startAutoUpdate runs the pinned upgrade detached, outside the project, and records it", () => {
  const home = useHome();
  const calls: { cmd: string; args: readonly string[]; options: Record<string, unknown> }[] = [];
  const spawn = fakeSpawn(calls);

  assert.equal(startAutoUpdate(MINOR_BUMP, spawn.impl, () => true), true);

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.cmd, process.execPath);
  assert.deepEqual(call.args, [process.argv[1], "upgrade", "--json"]);
  assert.equal(call.options.cwd, tmpdir());
  assert.equal(call.options.detached, true);
  assert.equal(call.options.stdio, "ignore");
  assert.equal((call.options.env as NodeJS.ProcessEnv).SW_AUTO_UPDATE, MINOR_BUMP);
  assert.equal(spawn.unrefs(), 1);
  const config = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")) as {
    autoUpdate: { version: string };
  };
  assert.equal(config.autoUpdate.version, MINOR_BUMP);
});

test("startAutoUpdate starts nothing without an entry point and reports a spawn failure", () => {
  useHome();
  const calls: { cmd: string; args: readonly string[]; options: Record<string, unknown> }[] = [];
  process.argv[1] = "";
  assert.equal(startAutoUpdate(MINOR_BUMP, fakeSpawn(calls).impl, () => true), false);
  assert.equal(calls.length, 0);

  process.argv[1] = entry ?? "";
  const failing = (() => {
    throw new Error("EAGAIN");
  }) as unknown as typeof spawn;
  assert.equal(startAutoUpdate(MINOR_BUMP, failing, () => true), false);
});

test("a CLI npm didn't install globally records the attempt and starts nothing", () => {
  const home = useHome();
  const calls: { cmd: string; args: readonly string[]; options: Record<string, unknown> }[] = [];

  assert.equal(startAutoUpdate(MINOR_BUMP, fakeSpawn(calls).impl, () => false), false);
  assert.equal(startAutoUpdate(MINOR_BUMP, fakeSpawn(calls).impl), false);

  assert.equal(calls.length, 0);
  const config = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")) as {
    autoUpdate: { version: string };
  };
  assert.equal(config.autoUpdate.version, MINOR_BUMP);
});

test("a run with a minor release cached starts the update and says so instead of the notice", () => {
  cached(useHome(), MINOR_BUMP);
  const stream = recordStream();
  const updates = starter();

  finishTerminal(stream, "text", "apps list", true, updates.start);

  assert.deepEqual(updates.started, [MINOR_BUMP]);
  assert.deepEqual(stream.written, [`Updating ${VERSION} → ${MINOR_BUMP} in the background\n`]);
});

test("--json starts the update and prints nothing", () => {
  cached(useHome(), MINOR_BUMP);
  const stream = recordStream();
  const updates = starter();

  finishTerminal(stream, "json", "apps list", true, updates.start);

  assert.deepEqual(updates.started, [MINOR_BUMP]);
  assert.deepEqual(stream.written, []);
});

test("--no-update, a major release or a failed start falls back to the notice", () => {
  const home = useHome();
  const notice = new RegExp(`Update available ${VERSION} → `);

  cached(home, MINOR_BUMP);
  const optedOut = recordStream();
  const untouched = starter();
  finishTerminal(optedOut, "text", "apps list", false, untouched.start);
  assert.deepEqual(untouched.started, []);
  assert.match(optedOut.written.join(), notice);

  cached(home, MAJOR_BUMP);
  const major = recordStream();
  finishTerminal(major, "text", "apps list", true, untouched.start);
  assert.deepEqual(untouched.started, []);
  assert.match(major.written.join(), notice);

  cached(home, MINOR_BUMP);
  const failed = recordStream();
  finishTerminal(failed, "rich", "apps list", true, () => false);
  assert.match(failed.written.join(), notice);

  const quiet = recordStream();
  finishTerminal(quiet, "json", "apps list", false, untouched.start);
  assert.deepEqual(quiet.written, []);
});

test("upgrade itself neither starts an update nor prints the notice", () => {
  cached(useHome(), MINOR_BUMP);
  const stream = recordStream();
  const updates = starter();

  finishTerminal(stream, "text", "upgrade", true, updates.start);

  assert.deepEqual(updates.started, []);
  assert.deepEqual(stream.written, []);
});
