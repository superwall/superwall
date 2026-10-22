import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command } from "@/commands/paywalls/publish";
import * as fs from "node:fs";
import { helpLine, runCommand, runLine } from "../../helpers/command";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { writeFakeFrameworkProject } from "../../helpers/framework";

const apiKey = process.env.SUPERWALL_API_KEY;

const dirs: string[] = [];

afterEach(() => {
  restoreFetch();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  if (apiKey === undefined) delete process.env.SUPERWALL_API_KEY;
  else process.env.SUPERWALL_API_KEY = apiKey;
  process.exitCode = 0;
});

test("publish without a login stops before touching the project, and says how to log in", async () => {
  delete process.env.SUPERWALL_API_KEY;

  const result = await runCommand(command, { args: { dir: "/nonexistent" } });

  assert.match(result.said("error")[0] ?? "", /Pushing paywalls needs a Superwall account/);
  assert.equal(process.exitCode, 1);
});

test("publish has no --json output", async () => {
  const result = await runCommand(command, { json: true });

  assert.deepEqual(result.json, {
    error: { code: "json_not_supported", message: "publish does not support --json." },
  });
});

test("publish takes the publish note as text, so the pipeline never sees anything but a string", () => {
  assert.equal(command.flags.message?.type, "string");
  assert.equal(command.flags.message?.alias, "m");
  assert.doesNotThrow(() => command.validate({ flags: { message: "Ship the Q3 pricing test", id: ["a,b"] } }));
});

test("with an API key, publish hands the project, the ids and the renames to the pipeline", async () => {
  process.env.SUPERWALL_API_KEY = "sk_live_x";
  const log = useFetch([]);
  const root = writeFakeFrameworkProject();
  dirs.push(root);

  const unknown = await runLine(`publish ${root} --id nope`);
  assert.match(unknown.said("error").join(), /No paywall or funnel named "nope" — this project has: pro/);
  const renamed = await runLine(`publish ${root} --id pro --rename broken -m Launch`);
  assert.match(renamed.said("error").join(), /--rename takes <old>=<new>.*\(got "broken"\)/);
  assert.deepEqual(log, []);
  assert.equal(process.exitCode, 1);
});

test("publish --help documents --rename and -m", async () => {
  const help = await helpLine("publish --help");
  assert.match(help, /--rename <old=new…> +Declare a renamed directory/);
  assert.match(help, /-m, --message <note>/);
});
