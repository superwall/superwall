import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { LoginRequiredError, requireApi } from "@/core/paywalls/project/session";
import { useRenderer } from "@/ui";
import { plainRenderer } from "@/ui/plain/renderer";
import { clearHomes, useHome } from "../../../helpers/home";
import { recordingRenderer, type RendererCall } from "../../../helpers/renderer";

const originalKey = process.env.SUPERWALL_API_KEY;
const originalHost = process.env.SUPERWALL_API_HOST;

afterEach(() => {
  if (originalKey === undefined) delete process.env.SUPERWALL_API_KEY;
  else process.env.SUPERWALL_API_KEY = originalKey;
  if (originalHost === undefined) delete process.env.SUPERWALL_API_HOST;
  else process.env.SUPERWALL_API_HOST = originalHost;
  useRenderer(plainRenderer);
  clearHomes();
});

async function refuseLogin(): Promise<null> {
  throw new Error("login must not run");
}

test("an API key authenticates without any stored session, against the configured host", async () => {
  useHome();
  process.env.SUPERWALL_API_KEY = "sk_test_123";
  process.env.SUPERWALL_API_HOST = "https://api.example.com";

  const api = await requireApi(false, refuseLogin);
  assert.equal(api.host, "https://api.example.com");
});

test("an API key with no host override talks to the production API", async () => {
  useHome();
  process.env.SUPERWALL_API_KEY = "sk_test_123";
  delete process.env.SUPERWALL_API_HOST;

  const api = await requireApi(false, refuseLogin);
  assert.equal(api.host, "https://api.superwall.com");
});

test("a stored session is used as is, without asking to log in", async () => {
  delete process.env.SUPERWALL_API_KEY;
  delete process.env.SUPERWALL_API_HOST;
  useHome({ apiKey: "sk_live_stored", host: "https://stored.example.com" });

  const api = await requireApi(true, refuseLogin);
  assert.equal(api.host, "https://stored.example.com");
});

test("no session and no key fails with both ways to authenticate", async () => {
  delete process.env.SUPERWALL_API_KEY;
  useHome();

  await assert.rejects(requireApi(false, refuseLogin), (error: Error) => {
    assert.ok(error instanceof LoginRequiredError);
    assert.match(error.message, /superwall login/);
    assert.match(error.message, /SUPERWALL_API_KEY/);
    return true;
  });
});

test("interactively, a signed-out user is told and logged in on the spot", async () => {
  delete process.env.SUPERWALL_API_KEY;
  delete process.env.SUPERWALL_API_HOST;
  useHome();
  const calls: RendererCall[] = [];
  useRenderer(recordingRenderer(calls));
  let logins = 0;

  const api = await requireApi(true, async () => {
    logins += 1;
    return { apiKey: "sk_live_new", host: "https://fresh.example.com", createdAt: "2026-01-01T00:00:00.000Z" };
  });

  assert.equal(logins, 1);
  assert.equal(api.host, "https://fresh.example.com");
  assert.deepEqual(calls, [
    { method: "info", value: "You're not signed in to Superwall yet — let's fix that." },
  ]);
});

test("interactively, a login that does not complete still needs an account", async () => {
  delete process.env.SUPERWALL_API_KEY;
  useHome();
  useRenderer(recordingRenderer());

  await assert.rejects(requireApi(true, async () => null), LoginRequiredError);
});
