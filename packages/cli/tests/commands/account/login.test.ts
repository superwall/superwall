import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { command as login } from "@/commands/account/login";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";
import { runCommand } from "../../helpers/command";

afterEach(() => {
  restoreFetch();
  clearHomes();
  delete process.env.SUPERWALL_API_HOST;
  process.exitCode = undefined;
});

const sessionFile = (home: string) => path.join(home, "auth.json");

test("login refuses browser login where nobody can approve it", async () => {
  useHome();

  const result = await runCommand(login, { interactive: false });

  assert.match(result.said("error").join(), /requires an interactive terminal/);
  assert.match(result.said("error").join(), /--api-key/);
  assert.equal(process.exitCode, 1);
});

test("login with an API key keeps the session and names the organization", async () => {
  const home = useHome();
  useFetch([{ match: "/v2/me/organizations", body: { data: [{ id: 42, name: "Solo Inc" }] } }]);

  const result = await runCommand(login, { flags: { apiKey: "sk_live_key" } });

  const saved = JSON.parse(fs.readFileSync(sessionFile(home), "utf8")) as {
    apiKey: string;
    orgId?: string;
    orgName: string;
    authMethod: string;
  };
  assert.equal(saved.apiKey, "sk_live_key");
  assert.equal(saved.orgId, undefined);
  assert.equal(saved.orgName, "Solo Inc");
  assert.equal(saved.authMethod, "api_key");
  assert.match(result.said("success").join(), /Logged in with an API key.*Solo Inc/);
  assert.match(result.said("outro").join(), /superwall integrate/);
});

test("login with an API key reports the account as data under --json", async () => {
  useHome();
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([{ match: "/v2/me/organizations", body: { data: [{ id: 7, name: "Acme" }] } }]);

  const result = await runCommand(login, { json: true, flags: { apiKey: "sk_live_key" } });

  assert.deepEqual(result.json, {
    authenticated: true,
    user: { email: null },
    credential: { type: "api_key" },
    host: "https://api.example.com",
  });
});

test("a rejected API key says so and keeps no session", async () => {
  const home = useHome();
  useFetch([{ match: "/v2/me/organizations", status: 401, body: { message: "nope" } }]);

  const result = await runCommand(login, { flags: { apiKey: "sk_bad" } });

  assert.equal(fs.existsSync(sessionFile(home)), false);
  assert.match(result.said("error").join(), /rejected/);
  assert.match(result.said("spinner.stop").join(), /Login failed/);
  assert.equal(process.exitCode, 1);
});

test("an empty API key is refused before any request", async () => {
  useHome();
  const log = useFetch([{ match: "/v2", body: {} }]);

  const result = await runCommand(login, { flags: { apiKey: "   " } });

  assert.match(result.said("error").join(), /requires an interactive terminal|API key is required/);
  assert.equal(log.length, 0);
});
