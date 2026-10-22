import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import {
  readSession,
  removeSession,
  resolveApiHost,
  serializeSession,
  sessionOrgName,
  writeSession,
  type Session,
} from "@/core/account/storage";
import { clearHomes, useHome } from "../../helpers/home";

afterEach(() => {
  clearHomes();
  delete process.env.SUPERWALL_API_HOST;
});

const session: Session = {
  authMethod: "oauth",
  userEmail: "dev@example.com",
  host: "https://api.example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
  accessToken: "at_1",
};

test("a session is written privately and read back", () => {
  const home = useHome();
  process.env.SUPERWALL_HOME = path.join(home, "fresh");

  writeSession(session);

  const file = path.join(home, "fresh", "auth.json");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readSession(), session);
});

test("no session file, or an unreadable one, means nobody is logged in", () => {
  const home = useHome();
  assert.equal(readSession(), null);

  fs.writeFileSync(path.join(home, "auth.json"), "{broken");
  assert.equal(readSession(), null);
});

test("removing the session forgets it, and removing nothing is fine", () => {
  useHome(session);

  removeSession();
  assert.equal(readSession(), null);
  assert.doesNotThrow(() => removeSession());
});

test("the API host is the override, then the session's host, then the default", () => {
  const home = useHome();
  fs.writeFileSync(path.join(home, "auth.json"), JSON.stringify({ apiKey: "sk_1", createdAt: "n" }));
  const hostless = readSession();
  assert.ok(hostless);

  assert.equal(resolveApiHost(session), "https://api.example.com");
  assert.equal(resolveApiHost(hostless), "https://api.superwall.com");

  process.env.SUPERWALL_API_HOST = "https://api.local.test";
  assert.equal(resolveApiHost(session), "https://api.local.test");
});

test("a serialized session names the credential kind and never the secret", () => {
  assert.deepEqual(serializeSession({ ...session, apiKey: "sk_secret" }), {
    authenticated: true,
    user: { email: "dev@example.com" },
    credential: { type: "api_key" },
    host: "https://api.example.com",
  });
  assert.deepEqual(serializeSession(session).credential, { type: "oauth" });
  assert.deepEqual(serializeSession({ host: "https://h", createdAt: "n" }), {
    authenticated: true,
    user: { email: null },
    credential: { type: "unknown" },
    host: "https://h",
  });
});

test("only an API key session names its organization", () => {
  assert.equal(sessionOrgName({ ...session, authMethod: "api_key", orgName: "Acme" }), "Acme");
  assert.equal(sessionOrgName({ ...session, orgName: "Stale" }), undefined);
  assert.equal(sessionOrgName(null), undefined);
  assert.equal(sessionOrgName(undefined), undefined);
});
