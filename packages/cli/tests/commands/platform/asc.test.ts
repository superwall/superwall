import assert from "node:assert/strict";
import { test } from "node:test";
import { executeCommand } from "@/command";
import { runAsc } from "@/commands/platform/asc";
import type { SuperwallApi } from "@/core/api/client";
import { recordingRenderer } from "../../helpers/renderer";

test("asc keys list honors --json without UI contamination", async () => {
  const api = {
    org: {},
    forOrg: (id: string) => ({ ...api, org: { id } }),
    list: async () => [{ id: 1, organization_id: "org-1", applications: [] }],
    get: async (path: string) => {
      assert.equal(path, "/v2/organizations/org-1/app-store-connect");
      return { data: [{ id: "team-1", name: "Primary" }] };
    },
  } as unknown as SuperwallApi;
  let stdout = "";
  const calls: Array<{ method: string }> = [];

  await executeCommand(
    runAsc.definition,
    { _: [], $0: "superwall", target: "keys", value: "list", json: true },
    {
      api: () => api,
      renderer: () => recordingRenderer(calls),
      stdout: {
        write: (value) => {
          stdout += String(value);
          return true;
        },
      },
      waitForPaint: false,
    },
  );

  assert.deepEqual(JSON.parse(stdout), [{ id: "team-1", name: "Primary" }]);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["start", "stop"],
  );
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
  await executeCommand(
    runAsc.definition,
    { _: [], $0: "superwall", target: "apps", app: "20", json: true },
    {
      api: () => api,
      nonInteractive: true,
      renderer: () => recordingRenderer(),
      stdout: { write: () => true },
      waitForPaint: false,
    },
  );
  assert.ok(paths.length > 0);
  assert.ok(paths.every((path) => path.startsWith("/v2/organizations/7/app-store-connect")));
});
