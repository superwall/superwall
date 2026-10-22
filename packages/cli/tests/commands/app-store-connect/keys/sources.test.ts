import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as keySources } from "@/commands/app-store-connect/keys/sources";
import { ApiError } from "@/core/api/client";
import { runWithApi as keys } from "../../../helpers/apple-setup";

afterEach(() => {
  process.exitCode = undefined;
});

test("keys sources lists the keys on the organization's other apps", async () => {
  const sources = {
    api_key: [{ application_id: "12", name: "Other App", key_id: "APIKEY0001", others_count: 2 }],
    purchase_key: [],
  };
  const routes = (method: string, path: string) =>
    method === "GET" && path.endsWith("/app-store-keys/copy-sources") ? sources : undefined;
  const json = await keys(keySources, { json: true, flags: { app: "8" } }, { routes });
  assert.deepEqual(json.json(), { application_id: "8", ...sources });
  const human = await keys(keySources, { flags: { app: "8" } }, { routes });
  assert.deepEqual(human.said("info"), [
    "`APIKEY0001`  App Store Connect API key  from Other App and 2 more (app 12)",
  ]);
  const none = await keys(keySources, { flags: { app: "8" } },
    { routes: (_method, path) => (path.endsWith("/copy-sources") ? { api_key: [], purchase_key: [] } : undefined) },
  );
  assert.deepEqual(none.said("step"), ["No other app has a key `Acme` could use"]);
});

test("an API that does not have the key endpoints yet says so and changes nothing", async () => {
  const run1 = await keys(keySources, { flags: { app: "8" } },
    {
      routes: (_method, path) => {
        if (path.endsWith("/copy-sources")) throw new ApiError(`GET ${path}`, 404, "");
        return undefined;
      },
    },
  );
  assert.deepEqual(run1.said("error"), [
    "The Superwall API at https://api.example.com can't list the keys on your other apps yet. Nothing was changed.",
  ]);

  const missingApp = await keys(keySources, { flags: { app: "8" } },
    {
      routes: (_method, path) => {
        if (path.endsWith("/copy-sources")) {
          throw new ApiError(`GET ${path}`, 404, '{"message":"No such application: 8"}');
        }
        return undefined;
      },
    },
  );
  assert.match(missingApp.said("error")[0] ?? "", /No such application: 8/);
});

