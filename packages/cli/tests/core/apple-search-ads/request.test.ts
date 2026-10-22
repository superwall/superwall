import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as asaGet } from "@/commands/apple-search-ads/api/get";
import { command as asaKeys } from "@/commands/apple-search-ads/keys";
import { command as asaPut } from "@/commands/apple-search-ads/api/put";
import { CONNECT_HINT, withAppleErrors } from "@/core/apple-search-ads/request";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import { fakeAsaApi } from "../../helpers/asa";
import { runCommand } from "../../helpers/command";
import { clearHomes, useHome } from "../../helpers/home";

afterEach(() => {
  clearHomes();
  process.exitCode = 0;
});

const rejectWith = (error: unknown) => () => Promise.reject(error);
const appleError = (body?: string) => new ApiError("POST /campaigns", 400, body);

test("withAppleErrors returns what the request returns", async () => {
  assert.deepEqual(await withAppleErrors("GET /me", async () => ({ id: 1 })), { id: 1 });
});

test("withAppleErrors points missing or bad credentials at the dashboard", async () => {
  for (const error of ["credentials_not_found", "invalid_credentials"]) {
    const failure = appleError(JSON.stringify({ error, message: "No key" }));
    await assert.rejects(withAppleErrors("GET /me", rejectWith(failure)), (thrown: Error) => {
      assert.equal(thrown.message, `${failure.message}\n${CONNECT_HINT}`);
      return true;
    });
  }
});

test("withAppleErrors lists each of Apple's field errors", async () => {
  const body = JSON.stringify({
    error: {
      errors: [
        { field: "budgetAmount", message: "must be positive", messageCode: "INVALID_BUDGET" },
        { field: "", message: "name is taken", messageCode: "" },
        { message: 7 },
        {},
        "not an object",
      ],
    },
  });
  await assert.rejects(withAppleErrors("POST /campaigns", rejectWith(appleError(body))), {
    message: [
      "Apple Search Ads rejected POST /campaigns (400):",
      "  • budgetAmount: must be positive (INVALID_BUDGET)",
      "  • name is taken",
      "  • 7",
      "  • ",
    ].join("\n"),
  });
});

test("withAppleErrors passes through errors it can't describe", async () => {
  const bodies = [undefined, "oops", "[1]", JSON.stringify({ error: { errors: [] } }), JSON.stringify({ error: "other" })];
  for (const body of bodies) {
    const failure = appleError(body);
    await assert.rejects(withAppleErrors("POST /campaigns", rejectWith(failure)), (thrown) => thrown === failure);
  }
  const plain = new Error("socket hang up");
  await assert.rejects(withAppleErrors("GET /me", rejectWith(plain)), (thrown) => thrown === plain);
});

test("asa get finds an app outside the listed accounts through its paywalls", async () => {
  useHome();
  const { api, requests } = fakeAsaApi((_method, path) => {
    if (path === "/v2/paywalls?application_id=77&limit=1") return { data: [{ project_id: 3 }] };
    if (path === "/v2/projects/3") {
      return { id: 3, organization_id: "org-3", applications: [{ id: 77, name: "Other", platform: "ios" }] };
    }
    return { data: [] };
  });
  await runCommand(asaGet, { api, args: { path: "/campaigns" }, flags: { app: "77", d: ["limit=3"] }, json: true });
  assert.equal(requests.at(-1)?.path, "/v2/organizations/org-3/apple-search-ads/proxy/77/api/v5/campaigns?limit=3");
});

test("asa get refuses an app whose account can't be told", async () => {
  useHome();
  const fake = fakeAsaApi();
  const api = {
    ...fake.api,
    list: async () => [{ id: 1, applications: [{ id: 5, name: "Loose", apple_search_ads_configured: true }] }],
  } as unknown as SuperwallApi;
  const result = await runCommand(asaGet, { api, args: { path: "/me" }, json: true });
  assert.equal((result.json as { error: { message: string } }).error.message, "Couldn't tell which account app 5 belongs to.");
  assert.ok(!fake.requests.some((request) => request.path.includes("/proxy/")));
});

test("asa put sends a non-object --body as given, with the org context header", async () => {
  useHome();
  const { api, requests } = fakeAsaApi();
  await runCommand(asaPut, {
    api,
    args: { path: "/campaigns/1/adgroups/2/targetingkeywords/bulk" },
    flags: { body: '[{"id":9,"status":"PAUSED"}]', d: ["ignored=1"], orgId: "40669820" },
    json: true,
  });
  assert.deepEqual(requests.at(-1), {
    method: "PUT",
    path: "/v2/organizations/org-1/apple-search-ads/proxy/5/api/v5/campaigns/1/adgroups/2/targetingkeywords/bulk",
    body: [{ id: 9, status: "PAUSED" }],
    headers: { "x-ap-context": "orgId=40669820" },
  });
});

test("asa put without --body sends the -d fields", async () => {
  useHome();
  const { api, requests } = fakeAsaApi();
  await runCommand(asaPut, { api, args: { path: "/campaigns/1" }, flags: { d: ["status=PAUSED"] }, json: true });
  assert.deepEqual(requests.at(-1)?.body, { status: "PAUSED" });
});

test("a path without a leading slash is refused before anything is sent", async () => {
  const { api, requests } = fakeAsaApi();
  const result = await runCommand(asaGet, { api, args: { path: "campaigns" }, json: true });
  assert.equal((result.json as { error: { message: string } }).error.message, 'Path must start with "/", e.g. /campaigns');
  assert.deepEqual(requests, []);
});

test("asa keys says how to connect when no app is connected, and counts apps in the plural", async () => {
  useHome();
  const fake = fakeAsaApi();
  const none = {
    ...fake.api,
    list: async () => [{ id: 1, organization_id: "o", applications: [{ id: 5, name: "A", platform: "ios" }] }],
  } as unknown as SuperwallApi;
  const empty = await runCommand(asaKeys, { api: none });
  assert.deepEqual(empty.said("step"), ["No app has Apple Search Ads connected"]);
  assert.deepEqual(empty.said("info"), [CONNECT_HINT]);

  const two = {
    ...fake.api,
    list: async () => [
      {
        id: 1,
        organization_id: "o",
        applications: [
          { id: 5, name: "A", platform: "ios", apple_search_ads_configured: true },
          { id: 6, platform: "IOS" },
          { id: 7, platform: "android" },
        ],
      },
    ],
  } as unknown as SuperwallApi;
  const listed = await runCommand(asaKeys, { api: two });
  assert.deepEqual(listed.said("step"), ["1 of 2 iOS apps connected to Apple Search Ads"]);
  assert.deepEqual(listed.said("info"), ["`A`  connected  5", "`6`  not connected  6"]);
});
