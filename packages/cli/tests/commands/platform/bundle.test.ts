import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { runBundle } from "@/commands/platform/bundle";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { run } from "../../helpers/command";

const STATIC_CONFIG = {
  build_id: "b1",
  paywall_responses: [
    { id: 7, identifier: "onboarding", url: "https://cdn.example.com/onboarding.html" },
  ],
  trigger_options: [
    { event_name: "onboarding", rules: [{ variants: [{ paywall_identifier: "onboarding" }] }] },
  ],
};

afterEach(() => {
  restoreFetch();
  delete process.env.SUPERWALL_PUBLIC_API_KEY;
  process.exitCode = undefined;
});

test("bundle --json writes the bundle from a public key alone, with no login", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sw-bundle-cmd-"));
  const log = useFetch([
    { match: "/api/v1/static_config?pk=pk_ci", body: STATIC_CONFIG },
    { match: "onboarding.html", text: '<img src="https://cdn.example.com/hero.png">' },
    { match: "hero.png", text: "png" },
  ]);

  const result = await run(runBundle.definition, {
    argv: { json: true, key: "pk_ci", placement: ["onboarding"], installDir: dir },
  });

  assert.equal(log[0]?.url, "https://api.superwall.me/api/v1/static_config?pk=pk_ci");
  const json = result.json as { out: string; buildId: string; paywalls: unknown[] };
  assert.equal(json.out, join(dir, "Superwall.bundle"));
  assert.equal(json.buildId, "b1");
  assert.deepEqual(json.paywalls, [
    { identifier: "onboarding", url: "https://cdn.example.com/onboarding.html", resources: 1 },
  ]);
  assert.deepEqual(
    JSON.parse(readFileSync(join(dir, "Superwall.bundle", "static_config.json"), "utf8")),
    STATIC_CONFIG,
  );
});

test("bundle reads the key from SUPERWALL_PUBLIC_API_KEY and honours --out", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sw-bundle-cmd-"));
  process.env.SUPERWALL_PUBLIC_API_KEY = "pk_env";
  const log = useFetch([
    { match: "static_config?pk=pk_env", body: STATIC_CONFIG },
    { match: "onboarding.html", text: "<p>hi</p>" },
  ]);

  const result = await run(runBundle.definition, {
    argv: { paywall: ["7"], out: "ios/App/Superwall.bundle", installDir: dir },
  });

  assert.equal(log.length, 2);
  assert.ok(existsSync(join(dir, "ios", "App", "Superwall.bundle", "bundle.json")));
  assert.ok(result.said("success").some((line) => line.includes("Superwall.bundle")));
});

test("bundle without a selection fails before touching the network", async () => {
  const log = useFetch([]);
  const result = await run(runBundle.definition, { argv: { json: true, key: "pk_ci" } });
  assert.equal(log.length, 0);
  assert.match((result.json as { error: { message: string } }).error.message, /--placement/);
});

test("bundle without a key or a login says how to provide one", async () => {
  useFetch([]);
  const result = await run(runBundle.definition, { argv: { json: true, all: true } });
  assert.match(
    (result.json as { error: { message: string } }).error.message,
    /--key or SUPERWALL_PUBLIC_API_KEY/,
  );
});

test("bundle --app looks the public key up when logged in", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sw-bundle-cmd-"));
  const log = useFetch([
    { match: "static_config?pk=pk_app", body: STATIC_CONFIG },
    { match: "onboarding.html", text: "<p>hi</p>" },
  ]);
  const api = {
    list: async (path: string) => {
      assert.equal(path, "/v2/projects");
      return [{ id: 1, applications: [{ id: 52518, name: "Zero", public_api_key: "pk_app" }] }];
    },
  };

  await run(runBundle.definition, {
    argv: { json: true, app: "52518", all: true, installDir: dir },
    api: api as never,
  });

  assert.ok(log.some((entry) => entry.url.includes("pk=pk_app")));
  assert.ok(existsSync(join(dir, "Superwall.bundle", "bundle.json")));
});
