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
        { name: "subscription", type: "object | null", required: false },
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

  await runLine("products update 12 --name Pro --yes --json", { api: fakeResourceApi(calls) });

  assert.deepEqual(calls, [{ method: "PATCH", path: "/v2/products/12", body: { name: "Pro" } }]);
});

const YEARLY = {
  id: "12",
  subscription: { period: "year", period_count: 1, trial_period_days: null, introductory_offer: { type: "free_trial" } },
};

test("products update --trial-days merges into the product's current subscription", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, { "GET /v2/products/12": YEARLY });

  await runLine("products update 12 --trial-days 3 --name Pro --yes --json", { api });

  assert.deepEqual(calls, [
    { method: "GET", path: "/v2/products/12" },
    {
      method: "PATCH",
      path: "/v2/products/12",
      body: { name: "Pro", subscription: { period: "year", period_count: 1, trial_period_days: 3 } },
    },
  ]);
});

test("products update --period and --period-count replace those parts of the subscription", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, { "GET /v2/products/12": YEARLY });

  await runLine("products update 12 --period month --period-count 3 --yes --json", { api });

  assert.deepEqual(calls.at(-1), {
    method: "PATCH",
    path: "/v2/products/12",
    body: { subscription: { period: "month", period_count: 3 } },
  });
});

test("products update --trial-days on a one-time product asks for --period", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, { "GET /v2/products/12": { id: "12", subscription: null } });

  const result = await runLine("products update 12 --trial-days 3 --yes --json", { api });

  assert.equal(
    (result.json as { error: { message: string } }).error.message,
    "Product 12 is a one-time purchase, so --trial-days needs --period to make it a subscription.",
  );
  assert.deepEqual(calls, [{ method: "GET", path: "/v2/products/12" }]);
});

test("products update --period turns a one-time product into a subscription", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, { "GET /v2/products/12": { id: "12", subscription: null } });

  await runLine("products update 12 --period week --trial-days 3 --yes --json", { api });

  assert.deepEqual(calls.at(-1), {
    method: "PATCH",
    path: "/v2/products/12",
    body: { subscription: { period_count: 1, period: "week", trial_period_days: 3 } },
  });
});

test("products update refuses --subscription together with --trial-days", async () => {
  const calls: ApiCall[] = [];

  const result = await runLine(`products update 12 --subscription {"period":"year"} --trial-days 3 --yes --json`, {
    api: fakeResourceApi(calls),
  });

  assert.equal(
    (result.json as { error: { message: string } }).error.message,
    "Pass --subscription or --trial-days, not both.",
  );
  assert.deepEqual(calls, []);
});

test("products update refuses a trial that isn't a whole number of days", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, { "GET /v2/products/12": YEARLY });

  const result = await runLine("products update 12 --trial-days 2.5 --yes --json", { api });

  assert.equal(
    (result.json as { error: { message: string } }).error.message,
    '--trial-days is a whole number of at least 0, not "2.5".',
  );
  assert.equal(calls.some((call) => call.method === "PATCH"), false);
});

test("products update --trial-days --dry-run reads the product and prints the PATCH", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, { "GET /v2/products/12": YEARLY });

  const result = await runLine("products update 12 --trial-days 7 --dry-run --json", { api });

  assert.deepEqual(calls, [{ method: "GET", path: "/v2/products/12" }]);
  assert.deepEqual(result.json, {
    method: "PATCH",
    path: "/v2/products/12",
    body: { subscription: { period: "year", period_count: 1, trial_period_days: 7 } },
  });
});

test("products update --subscription sends the JSON as an object, not a string", async () => {
  const calls: ApiCall[] = [];

  await runLine(
    `products update 692527 --subscription {"period":"year","period_count":1,"trial_period_days":3} --yes --json`,
    { api: fakeResourceApi(calls) },
  );

  assert.deepEqual(calls, [
    {
      method: "PATCH",
      path: "/v2/products/692527",
      body: { subscription: { period: "year", period_count: 1, trial_period_days: 3 } },
    },
  ]);
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
