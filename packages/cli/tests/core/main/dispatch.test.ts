import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, mock, test } from "node:test";
import { command as apps } from "@/commands/main/apps";
import { command as products } from "@/commands/main/products";
import { defineResource } from "@/core/main/define";
import { runCommand } from "../../helpers/command";
import { clearHomes, useHome } from "../../helpers/home";
import { routedApi, type Reply } from "../../helpers/routed-api";

beforeEach(() => {
  const home = useHome();
  fs.writeFileSync(path.join(home, "api-index.json"), JSON.stringify({ version: "test", fetchedAt: Date.now(), operations: [] }));
});

afterEach(() => {
  clearHomes();
  mock.restoreAll();
  process.exitCode = undefined;
});

const plain = (text: string) => text.replace(/\u001B\[[0-9;]*m/g, "");

const gadgets = defineResource({
  name: "gadgets",
  summary: "Gadgets",
  operations: [
    { name: "get", summary: "One gadget", method: "GET", path: "/v2/gadgets/{id}" },
    { name: "archive", summary: "Archive one", method: "POST", path: "/v2/gadgets/{id}/archive" },
  ],
  nested: [
    {
      name: "parts",
      summary: "Its parts",
      operations: [{ name: "create", summary: "Add a part", method: "POST", path: "/v2/gadgets/{id}/parts" }],
    },
  ],
  examples: [["gadgets get <gadget>", "One"]],
});

const PROJECT = { id: "1", name: "Lab", applications: [{ id: "10", name: "Lab", platform: "ios" }] };

async function dispatched(catalog: typeof gadgets, words: string[], routes: Record<string, Reply> = {}) {
  const { api, sent } = routedApi(routes);
  let printed = "";
  const write = process.stdout.write.bind(process.stdout);
  mock.method(process.stdout, "write", (value: string | Uint8Array) => (typeof value === "string" ? ((printed += value), true) : write(value)));
  let result;
  try {
    result = await runCommand(catalog, { words, json: true, api });
  } finally {
    mock.restoreAll();
  }
  const error = (result.json as { error?: { message: string } } | undefined)?.error?.message;
  return { result, sent, printed: plain(printed), error };
}

test("a resource named alone runs its list", async () => {
  const { result } = await dispatched(products, [], {
    "GET /v2/projects": [PROJECT],
    "GET /v2/products?project_id=1": [{ id: "p1" }],
  });
  assert.deepEqual(result.json, [{ id: "p1" }]);
});

test("an id or a dashboard link where the operation goes means get", async () => {
  const byId = await dispatched(gadgets, ["12"], { "GET /v2/gadgets/12": { id: 12 } });
  assert.deepEqual(byId.result.json, { id: 12 });

  const byLink = await dispatched(apps, ["https://app.superwall.com/9/10/campaigns"], {
    "GET /v2/projects": [PROJECT],
    "GET /internal/v2/applications/10/integrations/overview": { revenue_provider: null, app_store_connect_configuration: null, in_app_purchase_configuration: null },
    "GET /internal/v2/applications/10/bundle-id-suggestions": { window_days: 30, available: false, candidates: [] },
  });
  assert.equal((byLink.result.json as { app: { id: string } }).app.id, "10");
});

test("a resource with no list prints its help when named alone, and so does a nested resource", async () => {
  const owner = await dispatched(gadgets, []);
  assert.match(owner.printed, /^superwall gadgets <operation> \[ids\] \[flags\]/);
  assert.deepEqual(owner.sent, []);

  const nested = await dispatched(gadgets, ["parts"]);
  assert.match(nested.printed, /^superwall gadgets parts <operation>/);
});

test("an operation a resource doesn't have is refused with what it does take", async () => {
  const owner = await dispatched(gadgets, ["explode"]);
  assert.equal(owner.error, 'gadgets has no "explode". It takes: get, archive, parts.\nRun superwall gadgets --help for what each does.');

  const nested = await dispatched(gadgets, ["parts", "remove"]);
  assert.equal(nested.error, 'gadgets parts has no "remove". It takes: create.\nRun superwall gadgets parts --help for what each does.');
  assert.equal(process.exitCode, 1);
});

test("a nested operation runs against its own path", async () => {
  const { sent } = await dispatched(gadgets, ["parts", "create", "12"], { "POST /v2/gadgets/12/parts": { id: "p" } });
  assert.deepEqual(sent, [{ method: "POST", path: "/v2/gadgets/12/parts", body: {} }]);
});
