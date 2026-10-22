import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { fakeResourceApi, op, writeApiIndex, type ApiCall } from "../../helpers/resources";

beforeEach(() => {
  useFetch([]);
  writeApiIndex([
    op("GET", "/v2/products/{id}"),
    op("PATCH", "/v2/products/{id}", {
      body: [
        { name: "name", type: "string", required: false, description: "Display name" },
        { name: "trial_days", type: "number | null", required: false },
      ],
    }),
    op("DELETE", "/v2/products/{id}"),
    op("GET", "/v2/products/{id}/delete-impact", { description: "Campaigns and paywalls that use it." }),
  ]);
});

afterEach(() => {
  restoreFetch();
  process.exitCode = 0;
});

test("products list --project reads that project's products", async () => {
  const calls: ApiCall[] = [];
  const rows = [
    { id: "p1", identifier: "pro_monthly" },
    { id: "p2", identifier: "pro_yearly" },
  ];
  const api = fakeResourceApi(calls, { "LIST /v2/products?project_id=282": rows });

  const result = await runLine("products list --project 282 --search yearly --json", { api });

  assert.deepEqual(calls, [{ method: "LIST", path: "/v2/products?project_id=282" }]);
  assert.deepEqual(result.json, [{ id: "p2", identifier: "pro_yearly" }]);
});

test("updating a product types each field from the API reference", async () => {
  const calls: ApiCall[] = [];

  await runLine("products update 12 --name Pro --trial-days 7 --json", { api: fakeResourceApi(calls) });

  assert.deepEqual(calls, [{ method: "PATCH", path: "/v2/products/12", body: { name: "Pro", trial_days: 7 } }]);
});

test("deleting a product needs --yes outside a terminal, and its impact can be read first", async () => {
  const calls: ApiCall[] = [];
  const impact = { campaigns: [{ id: "c1", name: "Onboarding" }] };
  const api = fakeResourceApi(calls, { "GET /v2/products/12/delete-impact": impact });

  const shown = await runLine("products impact 12 --json", { api });
  assert.deepEqual(shown.json, impact);
  const refused = await runLine("products delete 12 --json", { api });
  assert.match((refused.json as { error: { message: string } }).error.message, /Delete a product: DELETE \/v2\/products\/12/);
  await runLine("products delete 12 --yes --json", { api });

  assert.deepEqual(calls, [
    { method: "GET", path: "/v2/products/12/delete-impact" },
    { method: "DELETE", path: "/v2/products/12" },
  ]);
});

test("a product id is required where the path needs one", async () => {
  const result = await runLine("products impact --json", { api: fakeResourceApi([]) });

  assert.match((result.json as { error: { message: string } }).error.message, /Usage: superwall products impact <product>/);
});

test("products --help lists create's flags, and impact --help the API's description", async () => {
  const help = await helpLine("products create --help");
  assert.match(help, /--identifier <id> +The store product ID/);
  assert.match(help, /--period <p> +day \| week \| month \| year/);

  const impact = await helpLine("products impact --help");
  assert.match(impact, /Campaigns and paywalls that use it\./);
  assert.match(impact, /<product> +The product's id/);

  const page = await helpLine("products --help");
  assert.match(page, /storekit +Write a StoreKit configuration file for Xcode/);
});
