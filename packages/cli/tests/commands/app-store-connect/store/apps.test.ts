import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as apps } from "@/commands/app-store-connect/store/apps";
import type { SuperwallApi } from "@/core/api/client";
import { fakeAscApi } from "../../../helpers/asc-proxy";
import { runCommand, runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = undefined;
});

test("asc reaches the App Store Connect keys of the organization of the app it's given", async () => {
  const paths: string[] = [];
  const api = {
    org: {},
    forOrg: (id: string) => ({ ...api, org: { id } }),
    list: async () => [
      { id: 1, organization_id: "42", applications: [{ id: 10, platform: "ios" }] },
      { id: 2, organization_id: "7", applications: [{ id: 20, platform: "ios" }] },
    ],
    get: async (path: string) => {
      paths.push(path);
      return { data: path.endsWith("/app-store-connect") ? [{ team_id: "T1" }] : [] };
    },
  } as unknown as SuperwallApi;
  await runCommand(apps, { flags: { app: "20" }, json: true, api });
  assert.ok(paths.length > 0);
  assert.ok(paths.every((path) => path.startsWith("/v2/organizations/7/app-store-connect")));
});

test("lists the team's apps with their bundle IDs", async () => {
  const { api, requests } = fakeAscApi({
    "GET /v1/apps?limit=200&fields[apps]=bundleId,name": {
      data: [{ id: "555", attributes: { name: "Acme", bundleId: "com.acme.app" } }],
    },
  });
  const human = await runCommand(apps, { api });
  assert.deepEqual(human.said("step"), ["1 app"]);
  assert.deepEqual(human.said("info"), ["`Acme`  com.acme.app  555"]);
  assert.equal(requests.at(-1)?.path, "/v2/organizations/7/app-store-connect/proxy/T1/v1/apps?limit=200&fields[apps]=bundleId,name");

  const json = await runCommand(apps, { api, json: true });
  assert.deepEqual(json.json, [{ id: "555", name: "Acme", bundleId: "com.acme.app" }]);
});

test("needs --team when the organization has several, and a connected one at all", async () => {
  const several = fakeAscApi({}, [{ team_id: "T1" }, { team_id: "T2" }]);
  const many = await runCommand(apps, { api: several.api });
  assert.deepEqual(many.said("error"), ["Multiple App Store Connect teams (T1, T2). Pass --team <id>."]);

  const picked = await runCommand(apps, { api: several.api, flags: { team: "T2" } });
  assert.deepEqual(picked.said("step"), ["0 apps"]);
  assert.match(several.requests.at(-1)?.path ?? "", /\/proxy\/T2\/v1\/apps/);

  const none = await runCommand(apps, { api: fakeAscApi({}, []).api });
  assert.deepEqual(none.said("error"), ["App Store Connect isn't connected. Run `superwall asc keys create --help`."]);
});

test("an app Apple returns without a name or bundle ID is listed by its id, through the parser", async () => {
  const { api, requests } = fakeAscApi(
    { "GET /v1/apps?limit=200&fields[apps]=bundleId,name": { data: [{ id: "556", attributes: {} }] } },
    [{ team_id: "T1" }, { team_id: "T2" }],
  );
  const result = await runLine("asc apps --team T1", { api });
  assert.deepEqual(result.said("info"), ["`556`    556"]);
  assert.match(requests.at(-1)?.path ?? "", /\/proxy\/T1\/v1\/apps/);
});
