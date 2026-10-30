import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { command as login } from "@/commands/account/login";
import { restoreFetch, useFetch, type Route } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";
import { runCommand } from "../../helpers/command";

afterEach(() => {
  restoreFetch();
  clearHomes();
  delete process.env.SUPERWALL_API_HOST;
  process.exitCode = undefined;
});

const sessionFile = (home: string) => path.join(home, "auth.json");

const DISCOVERY: Route = {
  match: "/.well-known/openid-configuration",
  body: {
    token_endpoint: "https://auth.test/oauth2/token",
    device_authorization_endpoint: "https://auth.test/oauth2/device_authorization",
  },
};

const DEVICE: Route = {
  match: "/oauth2/device_authorization",
  body: {
    device_code: "device-1",
    user_code: "ABCD-EFGH",
    verification_uri: "https://auth.test/device",
    verification_uri_complete: "https://auth.test/device?user_code=ABCD-EFGH",
    interval: 0,
    expires_in: 300,
  },
};

const PENDING: Route = { match: "/oauth2/token", status: 400, body: { error: "authorization_pending" } };
const APPROVED: Route = { match: "/oauth2/token", body: { access_token: "token-1", expires_in: 300 } };
const ORGS: Route = { match: "/v2/me/organizations", body: { data: [{ id: 7, name: "Acme" }] } };
const NO_ORGS: Route = { match: "/v2/me/organizations", body: { data: [] } };
const ME: Route = { match: "/v2/me", body: { email: "new@example.com" } };

const pendingFile = (home: string) => path.join(home, "pending-login.json");

function withoutBrowser<T>(work: () => Promise<T>): Promise<T> {
  process.env.BROWSER = "none";
  process.env.SUPERWALL_API_HOST = "https://api.test";
  return work().finally(() => {
    delete process.env.BROWSER;
  });
}

test("login without a terminal prints the link and code, and returns for --poll to finish", async () => {
  const home = useHome();
  useFetch([DISCOVERY, DEVICE]);

  const result = await withoutBrowser(() => runCommand(login, { flags: { host: "https://auth.test" } }));

  assert.match(result.said("info").join(), /ABCD-EFGH/);
  assert.match(result.said("info").join(), /https:\/\/auth\.test\/device\?user_code=ABCD-EFGH/);
  assert.match(result.said("warn").join(), /Couldn't open a browser/);
  assert.match(result.said("outro").join(), /superwall login --poll/);
  assert.equal(process.exitCode, undefined);
  assert.equal(fs.existsSync(pendingFile(home)), true);
  assert.equal(fs.existsSync(sessionFile(home)), false);
});

test("an agent starts with --json, polls while it's pending, and logs in once approved", async () => {
  const home = useHome();
  useFetch([DISCOVERY, DEVICE, PENDING]);

  const started = await withoutBrowser(() => runCommand(login, { json: true, flags: { host: "https://auth.test" } }));
  assert.deepEqual(
    { ...(started.json as Record<string, unknown>), expires_at: undefined },
    {
      status: "pending",
      verification_url: "https://auth.test/device?user_code=ABCD-EFGH",
      user_code: "ABCD-EFGH",
      expires_at: undefined,
      browser_opened: false,
      next: "superwall login --poll",
    },
  );

  const waiting = await runCommand(login, { json: true, flags: { poll: true, timeout: 0 } });
  assert.equal((waiting.json as { status: string }).status, "pending");
  assert.equal(process.exitCode, 1);

  process.exitCode = undefined;
  useFetch([APPROVED, ORGS, ME]);
  const done = await runCommand(login, { json: true, flags: { poll: true, timeout: 5 } });
  assert.deepEqual(done.json, {
    status: "logged_in",
    authenticated: true,
    user: { email: "new@example.com" },
    credential: { type: "oauth" },
    host: "https://api.test",
  });
  assert.equal(process.exitCode, undefined);
  assert.equal(fs.existsSync(pendingFile(home)), false);
});

test("a new account waits for --org-name, and --app-name creates its first app", async () => {
  const home = useHome();
  useFetch([DISCOVERY, DEVICE]);
  await withoutBrowser(() => runCommand(login, { json: true, flags: { host: "https://auth.test" } }));

  useFetch([APPROVED, NO_ORGS, ME]);
  const needs = await runCommand(login, { json: true, flags: { poll: true, timeout: 5 } });
  assert.equal((needs.json as { status: string }).status, "needs_organization");
  assert.equal((needs.json as { next: string }).next, 'superwall login --poll --org-name "<name>"');
  assert.equal(process.exitCode, 1);
  assert.equal(fs.existsSync(pendingFile(home)), true);

  process.exitCode = undefined;
  const log = useFetch([
    {
      match: "/internal/v2/onboarding/provision",
      body: { project: { id: 3, organization_id: 9, applications: [{ id: 11, public_api_key: "pk_new" }] } },
    },
    NO_ORGS,
    ME,
  ]);
  const done = await runCommand(login, {
    json: true,
    flags: { poll: true, timeout: 5, orgName: "Acme", appName: "Acme App", platform: "ios", bundleId: "com.acme.app" },
  });

  const provision = log.find((request) => request.url.endsWith("/internal/v2/onboarding/provision"));
  const body = JSON.parse(provision?.body ?? "{}") as Record<string, unknown>;
  assert.deepEqual(body.organization, { name: "Acme" });
  assert.deepEqual(body.applications, [{ name: "Acme App", platform: "ios", bundle_id: "com.acme.app" }]);
  assert.equal((done.json as { status: string }).status, "logged_in");
  assert.equal(process.exitCode, undefined);
  assert.equal(fs.existsSync(pendingFile(home)), false);
});

test("the same outcomes read as text at a terminal", async () => {
  useHome();
  useFetch([DISCOVERY, DEVICE, PENDING]);
  await withoutBrowser(() => runCommand(login, { flags: { host: "https://auth.test" } }));

  const waiting = await runCommand(login, { flags: { poll: true, timeout: 0 } });
  assert.match(waiting.said("info").join(), /Still waiting for approval · code `ABCD-EFGH`/);
  assert.match(waiting.said("info").join(), /Run `superwall login --poll` again/);

  useFetch([APPROVED, NO_ORGS, ME]);
  const needs = await runCommand(login, { flags: { poll: true, timeout: 5 } });
  assert.match(needs.said("warn").join(), /no organization yet/);

  process.exitCode = undefined;
  useFetch([{ match: "/v2/me/organizations", status: 200, body: { id: 9, name: "Acme" } }, ME]);
  const done = await runCommand(login, { flags: { poll: true, timeout: 5, orgName: "Acme" } });
  assert.match(done.said("spinner.stop").join(), /Logged in as `new@example.com`/);
  assert.match(done.said("outro").join(), /You're all set/);
});

test("polling with no login in progress fails", async () => {
  useHome();

  const result = await runCommand(login, { flags: { poll: true } });

  assert.match(result.said("error").join(), /No login in progress/);
  assert.match(result.said("spinner.stop").join(), /Login failed/);
  assert.equal(process.exitCode, 1);
});

test("app flags are refused unless they come together", async () => {
  useHome();
  const log = useFetch([]);
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ appName: "Acme App", platform: "ios" }, /--app-name needs --org-name/],
    [{ orgName: "Acme", appName: "Acme App" }, /--app-name needs --platform/],
    [{ orgName: "Acme", platform: "ios" }, /--platform and --bundle-id need --app-name/],
    [{ bundleId: "com.acme" }, /--platform and --bundle-id need --app-name/],
  ];
  for (const [flags, message] of cases) {
    const result = await runCommand(login, { flags: { poll: true, ...flags } });
    assert.match(result.said("error").join(), message);
  }
  assert.equal(log.length, 0);
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

test("a blank API key counts as none and never reaches the API", async () => {
  const home = useHome();
  const log = useFetch([DISCOVERY, DEVICE]);

  await withoutBrowser(() => runCommand(login, { flags: { apiKey: "   ", host: "https://auth.test" } }));

  assert.equal(log.some((request) => request.url.includes("/v2/")), false);
  assert.equal(fs.existsSync(pendingFile(home)), true);
  assert.equal(fs.existsSync(sessionFile(home)), false);
});
