import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { run } from "@/program/run";
import { VERSION } from "@/environment";

const argv = process.argv;
const channel = process.env.SUPERWALL_CHANNEL;
const apiKey = process.env.SUPERWALL_API_KEY;

afterEach(() => {
  process.argv = argv;
  process.env.SUPERWALL_CHANNEL = channel;
  if (apiKey === undefined) delete process.env.SUPERWALL_API_KEY;
  else process.env.SUPERWALL_API_KEY = apiKey;
  process.exitCode = 0;
  mock.restoreAll();
});

async function runWith(...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  process.argv = ["node", "superwall", ...args];
  let stdout = "";
  let stderr = "";
  mock.method(process.stdout, "write", (value: unknown) => {
    stdout += String(value);
    return true;
  });
  mock.method(process.stderr, "write", (value: unknown) => {
    stderr += String(value);
    return true;
  });
  process.exitCode = 0;
  await run();
  const code = Number(process.exitCode ?? 0);
  mock.restoreAll();
  return { stdout: stripVTControlCharacters(stdout), stderr: stripVTControlCharacters(stderr), code };
}

test("-v and --version print the version and nothing else", async () => {
  for (const flag of ["-v", "--version"]) {
    const { stdout, code } = await runWith(flag);
    assert.equal(stdout, `${VERSION}\n`);
    assert.equal(code, 0);
  }
});

test("no command, help, and a lone --help print the root help, marked with the channel", async () => {
  for (const args of [[], ["help"], ["--help"], ["-h"]]) {
    const { stdout, code } = await runWith(...args);
    assert.match(stdout, /^Superwall CLI v\S+ · next channel/);
    assert.match(stdout, /^App Store Connect$/m);
    assert.equal(code, 0);
  }
  process.env.SUPERWALL_CHANNEL = "latest";
  const { stdout } = await runWith();
  assert.doesNotMatch(stdout, /next channel|Paywalls & funnels/);
});

test("an unknown command is refused in one line, with no help dump", async () => {
  const { stdout, stderr, code } = await runWith("deploy", "now", "--fast");
  assert.equal(stdout, "");
  assert.equal(stderr, "✗ Unknown command: deploy now\n\nRun superwall --help for usage.\n");
  assert.equal(code, 1);
});

test("under --json, a refusal is a JSON error on stdout", async () => {
  const { stdout, stderr, code } = await runWith("nope", "--json");
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), { error: { code: "invalid_arguments", message: "Unknown command: nope" } });
  assert.equal(code, 1);
});

test("a bad flag names the command whose help explains it", async () => {
  const { stderr, code } = await runWith("asc", "keys", "list", "--bogus");
  assert.equal(stderr, "✗ Unknown flag: --bogus.\n\nRun superwall asc keys list --help for usage.\n");
  assert.equal(code, 1);
});

test("a topic prints its page, a command's --help its own, and a catalog's --help its operations", async () => {
  const topic = await runWith("asc");
  assert.match(topic.stdout, /^superwall asc <command>/);
  assert.match(topic.stdout, /^Keys and notifications$/m);
  const command = await runWith("asc", "keys", "list", "--help");
  assert.match(command.stdout, /^superwall asc keys list/);
  const catalog = await runWith("asa", "--help");
  assert.match(catalog.stdout, /^superwall asa <resource> <operation>/);
  assert.match(catalog.stdout, /^Resources$/m);
});

test("a command line runs the command", async () => {
  delete process.env.SUPERWALL_API_KEY;
  const { stdout, code } = await runWith("whoami", "--json");
  assert.deepEqual(JSON.parse(stdout), { authenticated: false });
  assert.equal(code, 0);
});
