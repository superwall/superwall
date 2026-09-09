import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { runLogin, runLogout, runWhoami } from "@/commands/account/auth";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";
import { run } from "../../helpers/command";

afterEach(() => {
  restoreFetch();
  clearHomes();
  delete process.env.SUPERWALL_API_HOST;
  process.exitCode = undefined;
});

const sessionFile = (home: string) => path.join(home, "auth.json");

test("whoami names the account, the credential and the host it talks to", async () => {
  useHome({ userEmail: "dev@example.com", orgName: "Solo Inc", apiKey: "sk_live_abcd" });

  const result = await run(runWhoami.definition);

  const [list] = result.calls.filter((call) => call.method === "list");
  const items = (list?.value as { items: { label: string; children: { label: string }[] }[] }).items;
  assert.equal(items[0]?.label, "dev@example.com");
  assert.match(String(items[0]?.children[0]?.label), /API key sk_…abcd/);
});

test("whoami says which credential kind is in play", async () => {
  useHome({ accessToken: "at_1", userEmail: "oauth@example.com" });
  const oauth = await run(runWhoami.definition);
  const items = (oauth.calls.find((c) => c.method === "list")?.value as {
    items: { children: { label: string }[] }[];
  }).items;
  assert.equal(items[0]?.children[0]?.label, "OAuth session");

  useHome({ userEmail: "bare@example.com" });
  const neither = await run(runWhoami.definition);
  const bare = (neither.calls.find((c) => c.method === "list")?.value as {
    items: { children: { label: string }[] }[];
  }).items;
  assert.equal(bare[0]?.children[0]?.label, " - ");
});

test("whoami with no session says how to sign in", async () => {
  useHome();

  const result = await run(runWhoami.definition);

  assert.match(result.said("error").join(), /aren't logged in/);
});

test("whoami --json reports the account as data, logged in or not", async () => {
  useHome({ userEmail: "dev@example.com", orgId: "42", orgName: "Solo Inc", apiKey: "sk_live_x" });

  const loggedIn = await run(runWhoami.definition, { argv: { json: true } });

  assert.deepEqual(loggedIn.json, {
    authenticated: true,
    user: { email: "dev@example.com" },
    organization: { id: "42", name: "Solo Inc", count: 1 },
    credential: { type: "api_key" },
    host: "https://api.example.com",
  });

  useHome();
  const loggedOut = await run(runWhoami.definition, { argv: { json: true } });
  assert.deepEqual(loggedOut.json, { authenticated: false });
});

test("logout forgets the session and says whose it was", async () => {
  const home = useHome({ userEmail: "dev@example.com" });

  const result = await run(runLogout.definition);

  assert.equal(fs.existsSync(sessionFile(home)), false);
  assert.match(result.said("success").join(), /Logged out \(dev@example\.com\)/);
});

test("logout asks first when someone is watching, and honours a no", async () => {
  const home = useHome({ userEmail: "dev@example.com" });
  const calls: { method: string; value?: unknown }[] = [];
  const renderer = {
    ...(await import("../../helpers/renderer")).recordingRenderer(calls),
    confirm: async () => false,
  };

  await run(runLogout.definition, { interactive: true, renderer });

  assert.equal(fs.existsSync(sessionFile(home)), true);
  assert.match(
    calls
      .filter((call) => call.method === "outro")
      .map((call) => String(call.value))
      .join(),
    /Staying logged in/,
  );
});

test("logout with nobody logged in says so instead of pretending", async () => {
  useHome();

  const result = await run(runLogout.definition);

  assert.match(result.said("error").join(), /aren't logged in yet/);
});

test("logout --json reports what it did without asking", async () => {
  const home = useHome({ userEmail: "dev@example.com" });

  const result = await run(runLogout.definition, { argv: { json: true }, interactive: true });

  assert.equal(fs.existsSync(sessionFile(home)), false);
  assert.equal((result.json as { loggedOut: boolean }).loggedOut, true);

  useHome();
  const empty = await run(runLogout.definition, { argv: { json: true } });
  assert.deepEqual(empty.json, { loggedOut: false, account: null });
});

test("login refuses browser login where nobody can approve it", async () => {
  useHome();

  const result = await run(runLogin.definition, { argv: { interactive: false } });

  assert.match(result.said("error").join(), /requires an interactive terminal/);
  assert.match(result.said("error").join(), /--api-key/);
  assert.equal(process.exitCode, 1);
});

test("login with an API key keeps the session and names the organization", async () => {
  const home = useHome();
  useFetch([{ match: "/v2/me/organizations", body: { data: [{ id: 42, name: "Solo Inc" }] } }]);

  const result = await run(runLogin.definition, { argv: { apiKey: "sk_live_key" } });

  const saved = JSON.parse(fs.readFileSync(sessionFile(home), "utf8")) as {
    apiKey: string;
    orgId: string;
    orgName: string;
    authMethod: string;
  };
  assert.equal(saved.apiKey, "sk_live_key");
  assert.equal(saved.orgId, "42");
  assert.equal(saved.orgName, "Solo Inc");
  assert.equal(saved.authMethod, "api_key");
  assert.match(result.said("success").join(), /Logged in with an API key.*Solo Inc/);
  assert.match(result.said("outro").join(), /superwall integrate/);
});

test("login with an API key reports the account as data under --json", async () => {
  useHome();
  process.env.SUPERWALL_API_HOST = "https://api.example.com";
  useFetch([{ match: "/v2/me/organizations", body: { data: [{ id: 7, name: "Acme" }] } }]);

  const result = await run(runLogin.definition, { argv: { apiKey: "sk_live_key", json: true } });

  assert.deepEqual(result.json, {
    authenticated: true,
    user: { email: null },
    organization: { id: "7", name: "Acme", count: 1 },
    credential: { type: "api_key" },
    host: "https://api.example.com",
  });
});

test("a rejected API key says so and keeps no session", async () => {
  const home = useHome();
  useFetch([{ match: "/v2/me/organizations", status: 401, body: { message: "nope" } }]);

  const result = await run(runLogin.definition, { argv: { apiKey: "sk_bad" } });

  assert.equal(fs.existsSync(sessionFile(home)), false);
  assert.match(result.said("error").join(), /rejected/);
  assert.match(result.said("spinner.stop").join(), /Login failed/);
  assert.equal(process.exitCode, 1);
});

test("an empty API key is refused before any request", async () => {
  useHome();
  const log = useFetch([{ match: "/v2", body: {} }]);

  const result = await run(runLogin.definition, { argv: { apiKey: "   " } });

  assert.match(result.said("error").join(), /requires an interactive terminal|API key is required/);
  assert.equal(log.length, 0);
});
