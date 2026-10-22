import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { ApiError } from "@/core/api/client";
import { runPaywallStage, runProductsStage, runVerifyStage, type StageCtx } from "@/core/workflows/dashboard-setup";
import { useRenderer } from "@/ui";
import { selectRenderer } from "@/ui/select";
import { answeringRenderer, prompted, said, type Answers } from "../../helpers/answers";
import type { RendererCall } from "../../helpers/renderer";
import { routedApi, type Reply } from "../../helpers/routed-api";

const cwd = process.cwd();

afterEach(() => {
  process.chdir(cwd);
  selectRenderer({ mode: "text" });
});

const SKIP = "__skip__";
const ASC = "/v2/organizations/9/app-store-connect";
const PROXY = `${ASC}/proxy/T1`;

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sw-dashboard-"));
}

async function products(
  answers: Answers,
  {
    routes = {},
    existing = [],
    teams = [],
    bundleId,
    projectDir,
  }: { routes?: Record<string, Reply>; existing?: unknown[]; teams?: unknown[]; bundleId?: string; projectDir?: string } = {},
) {
  const { api, sent } = routedApi(
    {
      "GET /v2/products?project_id=1": existing,
      [`GET ${ASC}`]: { data: teams },
      "POST /v2/products": (body) => ({ id: "new", ...(body as object) }),
      ...routes,
    },
    { id: "9" },
  );
  const calls: RendererCall[] = [];
  useRenderer(answeringRenderer(answers, calls));
  const ctx: StageCtx = { api, scope: { projectId: "1", applicationId: "10" }, appName: "Acme", bundleId, projectDir };
  await runProductsStage(ctx);
  const created = sent.filter((request) => request.method === "POST" && request.path === "/v2/products").map((request) => request.body);
  return { calls, sent, created };
}

type Option = { value: string; label: string; hint?: string; disabled?: boolean };
const optionsOf = (calls: RendererCall[], index = 0) =>
  (calls.filter((call) => call.method === "select")[index]?.value as { options: Option[] }).options;

test("with nothing yet, the choices say what's missing and skipping does nothing", async () => {
  const noOrg = routedApi({ "GET /v2/products?project_id=1": [] });
  const calls: RendererCall[] = [];
  useRenderer(answeringRenderer({ select: [SKIP] }, calls));
  await runProductsStage({ api: noOrg.api, scope: { projectId: "1" }, appName: "Acme" });
  assert.deepEqual(said(calls, "info"), ["No products in Superwall yet."]);
  assert.deepEqual(optionsOf(calls), [
    { value: "asc", label: "Import from App Store Connect", hint: "Connect your account" },
    { value: "storekit", label: "Import from a StoreKit file", hint: "No StoreKit file found", disabled: true },
    { value: SKIP, label: "Skip for now" },
  ]);
  assert.deepEqual(noOrg.sent.map((request) => request.method), ["GET"]);

  const dismissed = await products({ select: [null] });
  assert.deepEqual(dismissed.created, []);
});

test("existing products can be written out as a StoreKit file for Xcode", async () => {
  const dir = scratch();
  process.chdir(dir);
  const { calls } = await products(
    { select: ["export"] },
    { existing: [{ id: "p1", identifier: "pro_monthly" }, { id: "p2", identifier: "pro_yearly" }], teams: [{ team_id: "T1" }] },
  );
  assert.deepEqual(said(calls, "success"), ["2 products already in Superwall.", "Wrote `Superwall.storekit` with 2 products."]);
  assert.equal(optionsOf(calls)[0]?.hint, "Connected");
  assert.deepEqual(optionsOf(calls).map((option) => option.value), ["asc", "storekit", "export", SKIP]);
  const written = JSON.parse(fs.readFileSync(path.join(dir, "Superwall.storekit"), "utf8")) as { products: { productID: string }[] };
  assert.deepEqual(written.products.map((product) => product.productID), ["pro_monthly", "pro_yearly"]);

  const single = await products({ select: ["export"] }, { existing: [{ identifier: "pro" }] });
  assert.deepEqual(said(single.calls, "success"), ["1 product already in Superwall.", "Wrote `Superwall.storekit` with 1 product."]);
});

const STORE_PRODUCTS: Record<string, Reply> = {
  [`GET ${PROXY}/v1/apps/A1/subscriptionGroups?limit=200`]: { data: [{ id: "G1", attributes: { referenceName: "Pro" } }] },
  [`GET ${PROXY}/v1/subscriptionGroups/G1/subscriptions?limit=200`]: {
    data: [
      { id: "S1", attributes: { productId: "pro_monthly", name: "Pro Monthly", subscriptionPeriod: "ONE_MONTH" } },
      { id: "S2", attributes: { productId: "pro_yearly", subscriptionPeriod: "ONE_YEAR" } },
    ],
  },
  [`GET ${PROXY}/v1/apps/A1/inAppPurchasesV2?limit=200`]: {
    data: [
      { id: "I1", attributes: { productId: "lifetime", referenceName: "", inAppPurchaseType: "NON_CONSUMABLE" } },
      { id: "I2", attributes: { productId: "old", referenceName: "Old", inAppPurchaseType: "CONSUMABLE" } },
    ],
  },
};
const BY_BUNDLE = `GET ${PROXY}/v1/apps?filter[bundleId]=com.acme.app&fields[apps]=bundleId&limit=10`;
const ALL_APPS = `GET ${PROXY}/v1/apps?limit=200&fields[apps]=bundleId,name`;

test("a connected App Store Connect account finds the app by bundle ID and imports what's picked", async () => {
  const { calls, created } = await products(
    { select: ["asc"], multiselect: [["pro_monthly", "pro_yearly", "lifetime"]] },
    {
      existing: [{ id: "p0", identifier: "old" }],
      teams: [{ id: "T1" }],
      bundleId: "com.acme.app",
      routes: { [BY_BUNDLE]: { data: [{ id: "A1" }] }, ...STORE_PRODUCTS },
    },
  );
  const multiselect = calls.find((call) => call.method === "multiselect")?.value as { message: string; options: Option[]; initialValues: string[] };
  assert.equal(multiselect.message, "3 products to import from App Store Connect");
  assert.deepEqual(multiselect.options.map((option) => option.hint), ["Subscription · ONE_MONTH", "Subscription · ONE_YEAR", "Non-Consumable"]);
  assert.deepEqual(multiselect.initialValues, ["pro_monthly", "pro_yearly", "lifetime"]);
  assert.deepEqual(created, [
    { project_id: "1", identifier: "pro_monthly", name: "Pro Monthly" },
    { project_id: "1", identifier: "pro_yearly", name: "Pro" },
    { project_id: "1", identifier: "lifetime" },
  ]);
  assert.deepEqual(said(calls, "success").at(-1), "Imported 3 products from App Store Connect.");
});

test("everything already imported, or nothing picked, imports nothing", async () => {
  const done = await products(
    { select: ["asc"] },
    {
      existing: ["pro_monthly", "pro_yearly", "lifetime", "old"].map((identifier) => ({ identifier })),
      teams: [{ team_id: "T1" }],
      bundleId: "com.acme.app",
      routes: { [BY_BUNDLE]: { data: [{ id: "A1" }] }, ...STORE_PRODUCTS },
    },
  );
  assert.deepEqual(said(done.calls, "success").at(-1), "All App Store Connect products are already imported.");

  for (const picked of [null, []]) {
    const none = await products(
      { select: ["asc"], multiselect: [picked] },
      { teams: [{ team_id: "T1" }], bundleId: "com.acme.app", routes: { [BY_BUNDLE]: { data: [{ id: "A1" }] }, ...STORE_PRODUCTS } },
    );
    assert.deepEqual(none.created, []);
  }
});

test("with no app matching the bundle ID, the App Store Connect app is picked from the list", async () => {
  const { calls, created } = await products(
    { select: ["asc", "A1"], multiselect: [["lifetime"]] },
    {
      teams: [{ team_id: "T1" }],
      bundleId: "com.acme.app",
      routes: {
        [BY_BUNDLE]: { data: [] },
        [ALL_APPS]: { data: [{ id: "A1", attributes: { name: "Acme", bundleId: "com.acme.ios" } }, { id: "A2" }] },
        ...STORE_PRODUCTS,
      },
    },
  );
  assert.deepEqual(prompted(calls, "select")[1], "No App Store Connect app matches `com.acme.app`. Pick one:");
  assert.deepEqual(optionsOf(calls, 1), [
    { value: "A1", label: "Acme", hint: "com.acme.ios" },
    { value: "A2", label: "A2", hint: undefined },
  ]);
  assert.deepEqual(created, [{ project_id: "1", identifier: "lifetime" }]);
});

test("without a bundle ID the App Store Connect app is asked for, and backing out returns to the choices", async () => {
  const { calls, created } = await products(
    { select: ["asc", null, SKIP] },
    { teams: [{ team_id: "T1" }], routes: { [ALL_APPS]: { data: [{ id: "A1", attributes: { name: "Acme" } }] } } },
  );
  assert.deepEqual(prompted(calls, "select"), ["How do you want to add products?", "Which App Store Connect app?", "How do you want to add products?"]);
  assert.deepEqual(created, []);

  const empty = await products({ select: ["asc"] }, { teams: [{ team_id: "T1" }], routes: { [ALL_APPS]: { data: [] } } });
  assert.deepEqual(said(empty.calls, "info").at(-1), "No apps in your App Store Connect account yet - skipping product import.");
});

function keyFile(name = "AuthKey_ABC123DEFG.p8"): string {
  const dir = path.join(scratch(), "my keys");
  fs.mkdirSync(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, "-----BEGIN PRIVATE KEY-----\nMIGT\n-----END PRIVATE KEY-----\n");
  return file;
}

test("connecting App Store Connect reads the key, takes its ID from the file name, and retries a rejected issuer", async () => {
  const file = keyFile();
  let attempts = 0;
  const { calls, sent } = await products(
    { select: ["asc", SKIP], text: ["/nope/AuthKey_X.p8", file.replace(/ /g, "\\ "), "bad-issuer", " good-issuer "] },
    {
      routes: {
        [`POST ${ASC}`]: () => (++attempts === 1 ? new ApiError("POST /x", 400, "bad") : { team_id: "T1" }),
        [ALL_APPS]: { data: [] },
      },
    },
  );
  const note = calls.find((call) => call.method === "note")?.value as { title: string };
  assert.equal(note.title, "Connect App Store Connect");
  assert.deepEqual(prompted(calls, "text"), ["Path to the .p8 key file", "Path to the .p8 key file", "Issuer ID", "Issuer ID"]);
  assert.deepEqual(said(calls, "error"), [
    "Couldn't read `/nope/AuthKey_X.p8` - check the path and try again.",
    "Couldn't verify that key. Check the Issuer ID and that the .p8 matches the Key ID, then try again.",
  ]);
  assert.deepEqual(sent.filter((request) => request.method === "POST").at(-1)?.body, {
    key_id: "ABC123DEFG",
    issuer_id: "good-issuer",
    private_key: "-----BEGIN PRIVATE KEY-----\nMIGT\n-----END PRIVATE KEY-----\n",
    account_name: "Acme",
  });
  assert.deepEqual(said(calls, "success"), ["App Store Connect connected (team T1)."]);
  const validate = (calls.find((call) => call.method === "text")?.value as { validate: (v: string) => string | undefined }).validate;
  assert.equal(validate("  "), "Required");
  assert.equal(validate("x"), undefined);
});

test("a key file not named by Apple asks for its key ID, and a quoted path is unquoted", async () => {
  const file = keyFile("key.p8");
  const { sent } = await products(
    { select: ["asc", SKIP], text: [`'${file}'`, " KEY123 ", "issuer"] },
    { routes: { [`POST ${ASC}`]: { id: "T1" }, [ALL_APPS]: { data: [] } } },
  );
  assert.equal((sent.find((request) => request.method === "POST")?.body as { key_id: string }).key_id, "KEY123");

  const doubled = await products(
    { select: ["asc", SKIP], text: [`"${file}"`, null] },
    { routes: { [ALL_APPS]: { data: [] } } },
  );
  assert.deepEqual(prompted(doubled.calls, "text"), ["Path to the .p8 key file", "Key ID"]);
  assert.deepEqual(prompted(doubled.calls, "select").length, 2);
});

test("backing out of connecting returns to the choices, as does a connection with no team", async () => {
  const atPath = await products({ select: ["asc", SKIP], text: [null] });
  assert.deepEqual(prompted(atPath.calls, "select").length, 2);

  const atIssuer = await products({ select: ["asc", SKIP], text: [keyFile(), null] });
  assert.deepEqual(prompted(atIssuer.calls, "text"), ["Path to the .p8 key file", "Issuer ID"]);

  const teamless = await products({ select: ["asc", SKIP], text: [keyFile(), "issuer"] }, { routes: { [`POST ${ASC}`]: {} } });
  assert.deepEqual(said(teamless.calls, "success"), ["App Store Connect connected."]);
  assert.deepEqual(prompted(teamless.calls, "select").length, 2);
});

function storeKit(dir: string, name: string, content: unknown): string {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

const STOREKIT = {
  products: [{ productID: "coins" }, {}],
  nonRenewingSubscriptions: [{ productID: "season" }],
  subscriptionGroups: [{ subscriptions: [{ productID: "pro_monthly" }, { productID: "coins" }] }],
};

test("a StoreKit file in the project imports the products Superwall doesn't have yet", async () => {
  const dir = scratch();
  storeKit(dir, "App/Products.storekit", STOREKIT);
  storeKit(dir, "node_modules/lib/Ignored.storekit", STOREKIT);
  const { calls, created } = await products(
    { select: ["storekit"], multiselect: [["coins", "pro_monthly"]] },
    { projectDir: dir, existing: [{ product_identifier: "season" }] },
  );
  assert.deepEqual(optionsOf(calls)[1], { value: "storekit", label: "Import from a StoreKit file", hint: "Products.storekit", disabled: false });
  const multiselect = calls.find((call) => call.method === "multiselect")?.value as { message: string; initialValues: string[] };
  assert.equal(multiselect.message, "2 products in the StoreKit file");
  assert.deepEqual(multiselect.initialValues, ["coins", "pro_monthly"]);
  assert.deepEqual(created, [
    { project_id: "1", identifier: "coins" },
    { project_id: "1", identifier: "pro_monthly" },
  ]);
  assert.deepEqual(said(calls, "success").at(-1), "Imported 2 products from the StoreKit file.");
});

test("with several StoreKit files the one to import is asked for, and backing out returns to the choices", async () => {
  const dir = scratch();
  storeKit(dir, "A.storekit", { products: [{ productID: "a" }] });
  const second = storeKit(dir, "B.storekit", { products: [{ productID: "b" }] });
  const picked = await products({ select: ["storekit", second], multiselect: [["b"]] }, { projectDir: dir });
  assert.deepEqual(picked.created, [{ project_id: "1", identifier: "b" }]);
  assert.equal(prompted(picked.calls, "select")[1], "Which StoreKit file?");

  const back = await products({ select: ["storekit", null, SKIP] }, { projectDir: dir });
  assert.deepEqual(back.created, []);
  assert.equal(prompted(back.calls, "select").length, 3);
});

test("a StoreKit file that can't be read, lists nothing, or holds only known products imports nothing", async () => {
  const broken = scratch();
  storeKit(broken, "Broken.storekit", "{ not json");
  assert.deepEqual(said((await products({ select: ["storekit"] }, { projectDir: broken })).calls, "error"), [
    "Couldn't read `Broken.storekit` as a StoreKit file.",
  ]);

  const empty = scratch();
  storeKit(empty, "Empty.storekit", {});
  assert.deepEqual(said((await products({ select: ["storekit"] }, { projectDir: empty })).calls, "warn"), [
    "No products found in that StoreKit file.",
  ]);

  const known = scratch();
  storeKit(known, "Known.storekit", { products: [{ productID: "pro" }] });
  const result = await products({ select: ["storekit"] }, { projectDir: known, existing: [{ name: "pro" }] });
  assert.deepEqual(said(result.calls, "success").at(-1), "Those StoreKit products are already in Superwall.");

  const declined = await products({ select: ["storekit"], multiselect: [null] }, { projectDir: known });
  assert.deepEqual(declined.created, []);
});

test("the paywall stage points at building it as code or in the editor", () => {
  const calls: RendererCall[] = [];
  useRenderer(answeringRenderer({}, calls));
  runPaywallStage();
  const note = calls[0]?.value as { value: string; title: string };
  assert.equal(note.title, "Paywall");
  assert.match(note.value, /superwall create\s+scaffold a superwall\/ directory, then superwall publish/);
});

test("verifying checks for products and campaigns and says how to test end to end", async () => {
  const verify = async (rows: unknown[]) => {
    const { api } = routedApi({ "GET /v2/products?project_id=1": rows, "GET /v2/campaigns?application_id=10": rows });
    const calls: RendererCall[] = [];
    useRenderer(answeringRenderer({}, calls));
    await runVerifyStage({ api, scope: { projectId: "1", applicationId: "10" }, appName: "Acme" });
    return calls;
  };
  const ready = await verify([{ id: 1 }]);
  assert.deepEqual(said(ready, "success"), ["Products in Superwall: 1", "Campaigns: 1"]);
  assert.equal((ready.find((call) => call.method === "note")?.value as { title: string }).title, "Next");

  const empty = await verify([]);
  assert.deepEqual(said(empty, "warn"), ["Products in Superwall: 0", "Campaigns: 0"]);
});
