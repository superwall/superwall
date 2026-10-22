import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import type { BundleIdCandidate } from "@/core/api/integrations";
import { testModeExposure, testModeWarning } from "@/core/main/bundle-id";
import type { CommandContext } from "@/program/command";

const candidate = (bundleId: string, production: number, sandbox = 0) => ({
  bundle_id: bundleId,
  production_devices: production,
  sandbox_devices: sandbox,
  last_seen_at: "2026-10-14T17:00:00Z",
  top_country: "US",
});

const CANDIDATES = [
  candidate("com.acme.app", 9_630),
  candidate("com.acme.app.widget", 3_410),
  candidate("com.acme.habits", 1_204),
  candidate("com.acme.app.dev", 0, 300),
  candidate("com.acme.appkids", 50),
];

test("counts production devices on IDs that neither equal nor extend the chosen one", () => {
  assert.deepEqual(testModeExposure("com.acme.app", CANDIDATES), {
    devices: 1_254,
    bundleIds: ["com.acme.habits", "com.acme.appkids"],
  });
  assert.equal(testModeExposure("com.acme.app.widget", CANDIDATES).devices, 9_630 + 1_204 + 50);
  assert.equal(testModeExposure("com.acme.habits", [candidate("com.acme.habits", 4)]).devices, 0);
});

const ctx = { outputMode: "json" } as unknown as CommandContext;

function apiAnswering(answer: () => Promise<unknown>): { api: SuperwallApi; paths: string[] } {
  const paths: string[] = [];
  const api = {
    host: "https://api.test",
    get: async (path: string) => {
      paths.push(path);
      return answer();
    },
  } as unknown as SuperwallApi;
  return { api, paths };
}

const report = (candidates: BundleIdCandidate[], available = true) => async () => ({
  window_days: 30,
  available,
  candidates,
});

test("warns how many production devices a new bundle ID would put in test mode", async () => {
  const { api, paths } = apiAnswering(report(CANDIDATES));

  const warning = await testModeWarning(ctx, api, "42", "com.acme.app");

  assert.deepEqual(paths, ["/internal/v2/applications/42/bundle-id-suggestions"]);
  assert.equal(
    warning,
    "Saving the bundle ID com.acme.app: 1254 production devices in the last 30 days used com.acme.habits, com.acme.appkids, and would run in test mode.",
  );
});

test("one exposed device reads in the singular", async () => {
  const { api } = apiAnswering(report([candidate("com.acme.habits", 1)]));

  const warning = await testModeWarning(ctx, api, "42", "com.acme.app");

  assert.match(warning ?? "", /: 1 production device in the last 30 days used com\.acme\.habits,/);
});

test("no warning when nothing is exposed or the SDK report isn't available", async () => {
  const safe = apiAnswering(report([candidate("com.acme.app", 10), candidate("com.acme.app.widget", 4)]));
  const unavailable = apiAnswering(report(CANDIDATES, false));

  assert.equal(await testModeWarning(ctx, safe.api, "42", "com.acme.app"), undefined);
  assert.equal(await testModeWarning(ctx, unavailable.api, "42", "com.acme.app"), undefined);
});

test("an API that can't suggest bundle IDs yet skips the warning", async () => {
  const { api } = apiAnswering(async () => {
    throw new ApiError("GET /internal/v2/applications/42/bundle-id-suggestions", 404);
  });

  assert.equal(await testModeWarning(ctx, api, "42", "com.acme.app"), undefined);
});

test("any other API failure is not swallowed", async () => {
  const { api } = apiAnswering(async () => {
    throw new ApiError("GET /internal/v2/applications/42/bundle-id-suggestions", 500, "boom");
  });

  await assert.rejects(testModeWarning(ctx, api, "42", "com.acme.app"), /HTTP 500 — boom/);
});
