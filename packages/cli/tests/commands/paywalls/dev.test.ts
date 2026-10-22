import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { writeFakeFrameworkProject } from "../../helpers/framework";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  Reflect.deleteProperty(globalThis, "__superwallPreview");
  process.exitCode = 0;
});

function project(): string {
  const root = writeFakeFrameworkProject();
  dirs.push(root);
  return root;
}

function preview(): { roots: string[]; options: { port: number; host: string } } {
  return Reflect.get(globalThis, "__superwallPreview");
}

test("dev starts the project's preview server on the port and host asked for, and lists each surface's URL", async () => {
  const root = project();

  const result = await runLine(`dev ${root} --port 6200 --host 127.0.0.1`);

  assert.deepEqual(preview().roots, [root]);
  assert.equal(preview().options.port, 6200);
  assert.equal(preview().options.host, "127.0.0.1");
  assert.deepEqual(result.said("warn"), ["Port 6200 was in use — moved to 6201."]);
  const studio = result.said("step").join("\n");
  assert.match(studio, /Studio http:\/\/localhost:6201\//);
  assert.match(studio, /paywall\/pro {2}http:\/\/localhost:6201\/paywall\/pro/);
  assert.ok(fs.existsSync(path.join(root, "superwall.d.ts")));
  assert.deepEqual(result.said("error"), []);
});

test("dev serves several projects from one studio, each under its own prefix", async () => {
  const one = project();
  const two = project();

  const result = await runLine(`dev ${one} ${two} -p 7000`);

  assert.deepEqual(preview().roots, [one, two]);
  assert.equal(preview().options.host, "0.0.0.0");
  const studio = result.said("step").join("\n");
  assert.match(studio, new RegExp(`${path.basename(two)}/paywall/pro`));
});

test("dev outside a project says how to install the framework", async () => {
  const empty = fs.mkdtempSync(path.join(path.dirname(project()), "superwall-dev-empty-"));
  dirs.push(empty);

  const result = await runLine(`dev ${empty}`);

  assert.match(result.said("error").join(), /npm i superwall/);
  assert.equal(process.exitCode, 1);
});

test("dev refuses a port that isn't a number and --json, and documents its flags", async () => {
  await assert.rejects(runLine("dev --port next"), /--port takes a number/);
  const json = await runLine("dev --json");
  assert.deepEqual(json.json, { error: { code: "json_not_supported", message: "dev does not support --json." } });
  const help = await helpLine("dev --help");
  assert.match(help, /Host the studio: browse and preview your paywalls and funnels/);
  assert.match(help, /--port/);
  assert.match(help, /dev apps\/\*\/superwall --port 6200/);
  assert.doesNotMatch(help, /--open/);
});
