import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { DocOperation } from "@/core/api/reference";
import type { Resource } from "@/core/main/catalog";
import { listResourceTools } from "@/core/main/tools";

const op = (method: string, path: string, extra: Partial<DocOperation> = {}): DocOperation => ({
  method,
  path,
  group: "Test",
  summary: `${method} ${path}`,
  params: [],
  returns: [],
  ...extra,
});

const home = process.env.SUPERWALL_HOME!;
mkdirSync(home, { recursive: true });
writeFileSync(
  join(home, "api-index.json"),
  JSON.stringify({
    version: "test",
    fetchedAt: Date.now(),
    operations: [
      op("GET", "/v3/users/{app_user_id}/aliases", {
        params: [
          { name: "app_user_id", in: "path", type: "string", required: true },
          { name: "application_id", in: "query", type: "string", required: true },
        ],
      }),
      op("POST", "/v2/paywalls", {
        body: [
          { name: "application_id", type: "string", required: true },
          { name: "name", type: "string", required: true },
        ],
      }),
      op("GET", "/v2/paywalls/{id}"),
    ],
  }),
);

const resource: Resource = {
  name: "things",
  summary: "Things",
  operations: [
    { name: "aliases", summary: "Aliases", method: "GET", path: "/v3/users/{app_user_id}/aliases" },
    { name: "create", summary: "Create", method: "POST", path: "/v2/paywalls" },
    { name: "get", summary: "One", method: "GET", path: "/v2/paywalls/{id}" },
  ],
};

test("an operation whose app id is a query or body field takes the app as an input, like the CLI's --app", async () => {
  const tools = new Map((await listResourceTools(resource, {})).map((tool) => [tool.words.join(" "), tool.input]));
  assert.ok(tools.get("aliases")?.properties.app, "the app fills application_id in the query");
  assert.ok(tools.get("create")?.properties.app, "the app fills application_id in the body");
  assert.equal(tools.get("create")?.properties.application_id, undefined);
  assert.deepEqual(tools.get("create")?.required, ["name"]);
  assert.equal(tools.get("get")?.properties.app, undefined, "an operation with no app in it takes none");
});
