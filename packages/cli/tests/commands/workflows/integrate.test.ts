import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { command } from "@/commands/workflows/integrate";
import { helpLine, runCommand, runLine } from "../../helpers/command";

async function printed(flags: Record<string, unknown>) {
  let out = "";
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    if (typeof chunk !== "string") return write(chunk);
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  try {
    const result = await runCommand(command, { flags });
    return { out, result };
  } finally {
    process.stdout.write = write;
  }
}

test("integrate --skill prints the three-phase playbook instead of running", async () => {
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-integrate-skill-"));
  const { out, result } = await printed({ skill: true, installDir });
  assert.match(out, /^# Set up Superwall - full integration\n\nDo all three phases in order:/);
  assert.equal(result.calls.some((call) => call.method === "intro"), false);
});

const path0 = process.env.PATH;

afterEach(() => {
  process.env.PATH = path0;
  process.exitCode = 0;
});

function withoutLocalAgents(): void {
  process.env.PATH = fs.mkdtempSync(path.join(os.tmpdir(), "sw-integrate-empty-path-"));
}

test("integrate --driver names a backend, and one that isn't installed is refused with what was found", async () => {
  withoutLocalAgents();
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-integrate-driver-"));
  const result = await runLine(`integrate --install-dir ${installDir} --driver codex`);
  assert.deepEqual(result.said("error"), ['Driver "codex" not available. Detected: superwall.']);
  assert.equal(process.exitCode, 1);
});

test("integrate in a directory with no app says so, after checking the setup", async () => {
  withoutLocalAgents();
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-integrate-empty-"));
  const result = await runLine(`integrate --install-dir ${installDir} --no-interactive`);
  assert.match(result.said("error").join(), /app found in this directory/);
  assert.match(result.said("intro").join(), /Superwall v/);
});

test("integrate refuses a driver it doesn't know before running, and hides its internal flags from help", async () => {
  await assert.rejects(runLine("integrate --driver cursor"), /cursor/);
  const help = await helpLine("integrate --help");
  assert.match(help, /--api-key <key>/);
  assert.match(help, /--skill/);
  assert.doesNotMatch(help, /--driver/);
  assert.doesNotMatch(help, /--dry-run/);
});
