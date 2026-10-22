import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { resolveLine } from "@/program/parse";
import { command as create } from "@/commands/app-store-connect/keys/create";
import { command as remove } from "@/commands/app-store-connect/keys/delete";
import { command as importKeys } from "@/commands/app-store-connect/keys/import";
import { command as list } from "@/commands/app-store-connect/keys/list";
import { command as sources } from "@/commands/app-store-connect/keys/sources";
import { command as update } from "@/commands/app-store-connect/keys/update";
import type { SuperwallApi } from "@/core/api/client";
import { runWithApi as keys } from "../../../helpers/apple-setup";
import { runCommand } from "../../../helpers/command";
import { recordingRenderer, type RendererCall } from "../../../helpers/renderer";

afterEach(() => {
  process.exitCode = undefined;
});

const SAVED = {
  app_store_connect_configuration: { key_id: "APIKEY0001", issuer_id: "issuer-1", has_private_key: true },
  in_app_purchase_configuration: null,
};

test("keys list --app says which of the two keys the app has, and never a private key", async () => {
  const json = await keys(list, { json: true, flags: { app: "8" } }, { saved: SAVED });
  assert.deepEqual(json.json(), {
    application_id: "8",
    api_key: { key_id: "APIKEY0001", issuer_id: "issuer-1" },
    purchase_key: null,
  });
  const human = await keys(list, { flags: { app: "Acme" } }, { saved: SAVED });
  assert.deepEqual(human.said("report"), [
    "✓ App Store Connect API key  APIKEY0001\n✗ In-App Purchase key  not saved",
  ]);
});

test("without --app it lists the organization's keys, and --json stays clean of UI", async () => {
  const api = {
    org: {},
    forOrg: (id: string) => ({ ...api, org: { id } }),
    list: async () => [{ id: 1, organization_id: "org-1", applications: [] }],
    get: async (path: string) => {
      assert.equal(path, "/v2/organizations/org-1/app-store-connect");
      return { data: [{ id: "team-1", name: "Primary" }] };
    },
  } as unknown as SuperwallApi;
  const calls: RendererCall[] = [];

  const result = await runCommand(list, { json: true, api, renderer: recordingRenderer(calls) });

  assert.deepEqual(result.json, [{ id: "team-1", name: "Primary" }]);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["start", "stop"],
  );
});

test("unknown key commands name the ones that exist", () => {
  const groups = [
    {
      id: "app-store-connect",
      title: "App Store Connect",
      topics: [
        { name: "asc", summary: "The App Store Connect API" },
        { name: "asc keys", summary: "An app's Apple keys, and your organization's" },
      ],
      commands: [list, create, update, remove, importKeys, sources],
    },
  ];
  assert.throws(() => resolveLine(["asc", "keys", "rotate"], groups), {
    message: '`superwall asc keys` has no "rotate". It takes: list, create, update, delete, import, sources.',
  });
});
