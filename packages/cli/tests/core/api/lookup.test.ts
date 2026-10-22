import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ApiError, createSuperwallApi } from "@/core/api/client";
import { appNotFound, findApplication, findProject, parseDashboardUrl } from "@/core/api/lookup";
import { readOpenedOrgs } from "@/core/state/config";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";

afterEach(() => {
  restoreFetch();
  clearHomes();
});

const api = () =>
  createSuperwallApi({
    authMethod: "api_key",
    apiKey: "sk_live_x",
    host: "https://api.example.com",
    createdAt: new Date().toISOString(),
  });

const home = {
  id: "282",
  name: "Home",
  applications: [{ id: "5861", name: "Demo", platform: "ios" }],
};
const elsewhere = {
  id: "887",
  name: "WriteThis",
  organization_id: 1,
  applications: [{ id: "1022", name: "WriteThis iOS", platform: "ios" }],
};

const page = (data: unknown[]) => ({ data, has_more: false });

test("a dashboard link names the organization and the app", () => {
  assert.deepEqual(parseDashboardUrl("https://app.superwall.com/1/1022/dashboard"), {
    orgId: "1",
    applicationId: "1022",
  });
  assert.deepEqual(parseDashboardUrl("https://app.superwall.com/9162"), {
    orgId: "9162",
    applicationId: undefined,
  });
  assert.equal(parseDashboardUrl("https://example.com/1/1022"), undefined);
  assert.equal(parseDashboardUrl("https://app.superwall.com/settings"), undefined);
  assert.equal(parseDashboardUrl("1022"), undefined);
});

test("a project in the current organization is found without a request", async () => {
  const log = useFetch([]);
  assert.equal(await findProject(api(), "282", [home]), home);
  assert.deepEqual(log, []);
});

test("a project outside the current organization is asked for by id", async () => {
  useFetch([{ match: "/v2/projects/887", body: elsewhere }]);
  assert.deepEqual(await findProject(api(), "887", [home]), elsewhere);
});

test("a project the API doesn't know is not found, and any other failure is not hidden", async () => {
  useFetch([
    { match: "/v2/projects/404", status: 404, body: { error: { message: "No such project" } } },
    { match: "/v2/projects/500", status: 500, text: "boom" },
  ]);
  assert.equal(await findProject(api(), "404", [home]), undefined);
  await assert.rejects(findProject(api(), "500", [home]), ApiError);
});

test("an app in another organization is found through its paywalls", async () => {
  useFetch([
    { match: "/v2/paywalls?application_id=1022", body: page([{ id: "1", project_id: "887" }]) },
    { match: "/v2/projects/887", body: elsewhere },
  ]);
  const found = await findApplication(api(), "1022", [home]);
  assert.equal(found?.project.id, "887");
  assert.equal(found?.app.id, "1022");
});

test("an app with no paywalls is found through the organization its dashboard link names", async () => {
  const log = useFetch([
    { match: "/v2/paywalls?application_id=1022", body: page([]) },
    { match: "/v2/projects?organization_id=1", body: page([elsewhere]) },
  ]);
  const found = await findApplication(api(), "https://app.superwall.com/1/1022/dashboard", [home]);
  assert.equal(found?.app.id, "1022");
  assert.ok(log.some((call) => call.url.includes("organization_id=1")));
});

test("an app by name is only looked for in the current organization", async () => {
  const log = useFetch([]);
  assert.equal((await findApplication(api(), "Demo", [home]))?.app.id, "5861");
  assert.equal(await findApplication(api(), "WriteThis iOS", [home]), undefined);
  assert.deepEqual(log, []);
});

test("an app id nobody can open is not found", async () => {
  useFetch([{ match: "/v2/paywalls?application_id=77", body: page([]) }]);
  assert.equal(await findApplication(api(), "77", [home]), undefined);
});

test("with no projects given, the account's projects are listed first", async () => {
  useHome();
  const log = useFetch([{ match: "/v2/projects?limit=100", body: page([home]) }]);
  assert.equal((await findApplication(api(), "5861"))?.project.id, "282");
  assert.deepEqual(log.map((call) => call.url), ["https://api.example.com/v2/projects?limit=100"]);
});

test("a paywall lookup the API refuses means not found, and any other failure is not hidden", async () => {
  useHome();
  useFetch([{ match: "/v2/paywalls?application_id=77", status: 403, body: { error: { message: "Forbidden" } } }]);
  assert.equal(await findApplication(api(), "77", [home]), undefined);
  useFetch([{ match: "/v2/paywalls?application_id=77", status: 500, text: "boom" }]);
  await assert.rejects(findApplication(api(), "77", [home]), ApiError);
  useFetch([{ match: "/v2/paywalls?application_id=77", body: {} }]);
  assert.equal(await findApplication(api(), "77", [home]), undefined);
});

test("a paywall whose project no longer holds the app falls back to the dashboard link, and remembers nothing it didn't find", async () => {
  useHome();
  const log = useFetch([
    { match: "/v2/paywalls?application_id=1022", body: page([{ id: "1", project_id: "404" }]) },
    { match: "/v2/projects/404", status: 404, body: { error: { message: "No such project" } } },
    { match: "/v2/projects?organization_id=1", body: page([{ id: "887", applications: [] }]) },
  ]);
  assert.equal(await findApplication(api(), "https://app.superwall.com/1/1022", [home]), undefined);
  assert.ok(log.some((call) => call.url.includes("organization_id=1")));
  assert.deepEqual(readOpenedOrgs(), []);

  useFetch([
    { match: "/v2/paywalls?application_id=1022", body: page([{ id: "1", project_id: "282" }]) },
    { match: "/v2/projects/282", body: home },
  ]);
  assert.equal(await findApplication(api(), "1022", [home]), undefined);
});

test("an app that can't be found is explained with the dashboard link that would find it", () => {
  assert.equal(
    appNotFound("1022").message,
    "No app 1022 that this account can open. Pass its dashboard link instead — https://app.superwall.com/<org>/<app>/… names the organization, which finds apps that have no paywalls yet.",
  );
});
