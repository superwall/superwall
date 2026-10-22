import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { command } from "@/commands/workflows/review";
import { readBundledSkill } from "@/core/support/skills";
import { helpLine, runCommand, runLine } from "../../helpers/command";

async function printed(flags: Record<string, unknown>): Promise<string> {
  let out = "";
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    if (typeof chunk !== "string") return write(chunk);
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  try {
    await runCommand(command, { flags });
    return out;
  } finally {
    process.stdout.write = write;
  }
}

test("review --skill prints the review playbook, with or without --fix", async () => {
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-review-skill-"));
  const expected = `${readBundledSkill("superwall-review")}\n`;
  assert.equal(await printed({ skill: true, installDir }), expected);
  assert.equal(await printed({ skill: true, fix: true, installDir }), expected);
});

const path0 = process.env.PATH;

afterEach(() => {
  process.env.PATH = path0;
  process.exitCode = 0;
});

test("review without --skill runs the review, which needs an app to look at", async () => {
  process.env.PATH = fs.mkdtempSync(path.join(os.tmpdir(), "sw-review-empty-path-"));
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-review-empty-"));
  const result = await runLine(`review --fix --install-dir ${installDir}`);
  assert.match(result.said("intro").join(), /Superwall v/);
  assert.match(result.said("error").join(), /app found in this directory/);
  assert.equal(process.exitCode, 1);
});

test("review --help offers --fix", async () => {
  const help = await helpLine("review --help");
  assert.match(help, /--fix +Apply verified, safe fixes from the latest review/);
});
