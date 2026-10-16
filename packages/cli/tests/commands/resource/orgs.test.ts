import assert from "node:assert/strict";
import { test } from "node:test";
import { runOrgs } from "@/commands/resource/orgs";

function capture(argv: string[]): { stdout: string; stderr: string } {
  const saved = { argv: process.argv, out: process.stdout.write, err: process.stderr.write };
  let stdout = "";
  let stderr = "";
  process.argv = ["node", "superwall", ...argv];
  process.stdout.write = ((chunk: string) => (
    (stdout += chunk), true
  )) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => (
    (stderr += chunk), true
  )) as typeof process.stderr.write;
  try {
    runOrgs();
  } finally {
    process.argv = saved.argv;
    process.stdout.write = saved.out;
    process.stderr.write = saved.err;
  }
  return { stdout, stderr };
}

test("orgs use only warns, so old scripts keep running", () => {
  const { stdout, stderr } = capture(["orgs", "use", "3642"]);
  assert.equal(stdout, "");
  assert.match(stderr, /Organizations are gone[\s\S]*apps list[\s\S]*--app/);
  assert.notEqual(process.exitCode, 1);
});

test("orgs --json says it's retired as data", () => {
  const { stdout } = capture(["orgs", "list", "--json"]);
  assert.deepEqual(Object.keys(JSON.parse(stdout)), ["retired", "message"]);
  assert.equal(JSON.parse(stdout).retired, true);
});
