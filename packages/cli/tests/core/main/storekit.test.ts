import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { command as products } from "@/commands/main/products";
import { describeSkipped, generateStoreKit } from "@/core/main/storekit";
import { said } from "../../helpers/answers";
import { runCommand } from "../../helpers/command";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";
import { routedApi } from "../../helpers/routed-api";

const cwd = process.cwd();

afterEach(() => {
  process.chdir(cwd);
  process.exitCode = undefined;
});

const PROJECT = { id: "1", name: "Lab", applications: [{ id: "10", platform: "ios" }] };

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sw-storekit-"));
}

async function storekit(flags: Record<string, unknown>, rows: unknown[], json = false) {
  const { api } = routedApi({ "GET /v2/projects": [PROJECT], "GET /v2/products?project_id=1": rows });
  const calls: RendererCall[] = [];
  const result = await runCommand(products, { words: ["storekit"], flags, json, api, renderer: recordingRenderer(calls) });
  return { result, calls };
}

const USD = (amount: number) => ({ amount, currency: "USD" });

const MONTHLY = {
  id: "689830",
  identifier: "com.floatbrowse.pro.monthly",
  name: null,
  platform: "ios",
  store: "app_store",
  price: USD(399),
  trial_price: USD(0),
  subscription: { period: "month", period_count: 1, trial_period_days: 7 },
};

const YEARLY = {
  id: "689831",
  identifier: "com.floatbrowse.pro.yearly",
  name: null,
  platform: "ios",
  store: "app_store",
  price: USD(2499),
  trial_price: USD(0),
  subscription: { period: "year", period_count: 1, trial_period_days: 7 },
};

interface Offer {
  displayPrice?: string;
  internalID: string;
  numberOfPeriods?: number;
  paymentMode: string;
  subscriptionPeriod: string;
}

interface Written {
  products: Array<Record<string, unknown>>;
  settings: Record<string, unknown>;
  subscriptionGroups: Array<{ id: string; name: string; subscriptions: Array<Record<string, unknown> & { introductoryOffer: Offer | null }> }>;
  version: unknown;
}

function written(rows: unknown[], teamId?: string): { file: Written; written: number; skipped: unknown[] } {
  const result = generateStoreKit(rows as never[], { teamId });
  return { ...result, file: JSON.parse(JSON.stringify(result.file)) as Written };
}

test("subscriptions are written as auto-renewables in one group, with their price, period and free trial", () => {
  const { file, written: count, skipped } = written([MONTHLY, YEARLY]);
  assert.equal(count, 2);
  assert.deepEqual(skipped, []);
  assert.deepEqual(file.products, []);
  assert.deepEqual(file.settings, {});
  assert.deepEqual(file.version, { major: 3, minor: 0 });
  assert.deepEqual(file.subscriptionGroups, [
    {
      id: "20000000",
      localizations: [],
      name: "Subscriptions",
      subscriptions: [
        {
          adHocOffers: [],
          codeOffers: [],
          displayPrice: "3.99",
          familyShareable: false,
          internalID: "1000",
          localizations: [{ description: "com.floatbrowse.pro.monthly", displayName: "com.floatbrowse.pro.monthly", locale: "en_US" }],
          productID: "com.floatbrowse.pro.monthly",
          referenceName: "com.floatbrowse.pro.monthly",
          groupNumber: 2,
          introductoryOffer: { internalID: "000003E8", numberOfPeriods: 1, paymentMode: "free", subscriptionPeriod: "P1W" },
          recurringSubscriptionPeriod: "P1M",
          subscriptionGroupID: "20000000",
          type: "RecurringSubscription",
        },
        {
          adHocOffers: [],
          codeOffers: [],
          displayPrice: "24.99",
          familyShareable: false,
          internalID: "1001",
          localizations: [{ description: "com.floatbrowse.pro.yearly", displayName: "com.floatbrowse.pro.yearly", locale: "en_US" }],
          productID: "com.floatbrowse.pro.yearly",
          referenceName: "com.floatbrowse.pro.yearly",
          groupNumber: 1,
          introductoryOffer: { internalID: "000003E9", numberOfPeriods: 1, paymentMode: "free", subscriptionPeriod: "P1W" },
          recurringSubscriptionPeriod: "P1Y",
          subscriptionGroupID: "20000000",
          type: "RecurringSubscription",
        },
      ],
    },
  ]);
});

test("a billing period keeps its unit and count, and defaults to one", () => {
  const period = (subscription: unknown) =>
    written([{ identifier: "p", price: USD(100), subscription }]).file.subscriptionGroups[0]?.subscriptions[0]?.recurringSubscriptionPeriod;
  assert.equal(period({ period: "week", period_count: 1 }), "P1W");
  assert.equal(period({ period: "month", period_count: 3 }), "P3M");
  assert.equal(period({ period: "day", period_count: 7 }), "P7D");
  assert.equal(period({ period: "year" }), "P1Y");
  assert.equal(period({ period: "month", period_count: 0 }), "P1M");
  assert.equal(period({ period: "month", period_count: "2" }), "P1M");
});

test("a trial becomes the introductory offer Xcode would write for that length", () => {
  const offer = (trial_period_days: unknown, trial_price?: unknown) =>
    written([{ identifier: "p", price: USD(999), trial_price, subscription: { period: "month", trial_period_days } }]).file.subscriptionGroups[0]
      ?.subscriptions[0]?.introductoryOffer;
  assert.equal(offer(3)?.subscriptionPeriod, "P3D");
  assert.equal(offer(7)?.subscriptionPeriod, "P1W");
  assert.equal(offer(14)?.subscriptionPeriod, "P2W");
  assert.equal(offer(30)?.subscriptionPeriod, "P1M");
  assert.equal(offer(60)?.subscriptionPeriod, "P2M");
  assert.equal(offer(90)?.subscriptionPeriod, "P3M");
  assert.equal(offer(180)?.subscriptionPeriod, "P6M");
  assert.equal(offer(365)?.subscriptionPeriod, "P1Y");
  assert.equal(offer(5)?.subscriptionPeriod, "P5D");
  assert.equal(offer(7, null)?.paymentMode, "free");
  assert.equal(offer(undefined), null);
  assert.equal(offer(null), null);
  assert.equal(offer(0), null);
  assert.deepEqual(offer(7, USD(99)), { displayPrice: "0.99", internalID: "000003E8", numberOfPeriods: 1, paymentMode: "payUpFront", subscriptionPeriod: "P1W" });
});

test("a one-time product stays a top-level product at its real price, named by its name", () => {
  const { file } = written([
    { id: "p1", identifier: "lifetime", name: " Lifetime ", store: "app_store", price: USD(4900), subscription: null },
    { id: "p2", product_identifier: "coins", platform: "ios", price: USD(0) },
    { id: "p3", name: "Legacy", price: USD(150), subscription: { period: "fortnight" } },
  ]);
  assert.deepEqual(file.subscriptionGroups, []);
  assert.deepEqual(file.products, [
    {
      displayPrice: "49.00",
      familyShareable: false,
      internalID: "1000",
      localizations: [{ description: "Lifetime", displayName: "Lifetime", locale: "en_US" }],
      productID: "lifetime",
      referenceName: "Lifetime",
      type: "NonConsumable",
    },
    {
      displayPrice: "0.00",
      familyShareable: false,
      internalID: "1001",
      localizations: [{ description: "coins", displayName: "coins", locale: "en_US" }],
      productID: "coins",
      referenceName: "coins",
      type: "NonConsumable",
    },
    {
      displayPrice: "1.50",
      familyShareable: false,
      internalID: "1002",
      localizations: [{ description: "Legacy", displayName: "Legacy", locale: "en_US" }],
      productID: "Legacy",
      referenceName: "Legacy",
      type: "NonConsumable",
    },
  ]);
});

test("subscriptions rank by price, the dearest first, and keep the order they came in", () => {
  const sub = (identifier: string, amount: number) => ({ identifier, price: USD(amount), subscription: { period: "month" } });
  const { file } = written([sub("mid", 999), { identifier: "once", price: USD(100) }, sub("top", 4999), sub("low", 399)]);
  assert.deepEqual(
    file.subscriptionGroups[0]?.subscriptions.map((s) => [s.productID, s.groupNumber, s.internalID]),
    [["mid", 2, "1000"], ["top", 1, "1002"], ["low", 3, "1003"]],
  );
  assert.deepEqual(file.products.map((p) => [p.productID, p.internalID]), [["once", "1001"]]);
});

test("products of another store, with no price or with no identifier are left out and reported", () => {
  const { file, written: count, skipped } = written([
    MONTHLY,
    { id: "a1", identifier: "play.pro:monthly", platform: "android", store: "play_store", price: USD(399) },
    { id: "s1", identifier: "live:price_1:none", platform: "stripe", price: USD(399) },
    { id: "c1", identifier: "custom.pro", platform: "ios", store: "custom", price: USD(399) },
    { id: "n1", identifier: "unpriced", store: "app_store", price: null },
    { id: "n2", identifier: "badprice", store: "app_store", price: { amount: "399" } },
    { id: "n3", identifier: "negative", store: "app_store", price: USD(-1) },
    { id: "x1", identifier: " ", price: USD(100) },
    { price: USD(100) },
  ]);
  assert.equal(count, 1);
  assert.deepEqual(file.subscriptionGroups[0]?.subscriptions.map((s) => s.productID), ["com.floatbrowse.pro.monthly"]);
  assert.deepEqual(file.products, []);
  assert.deepEqual(skipped, [
    { identifier: "play.pro:monthly", reason: "other_store" },
    { identifier: "live:price_1:none", reason: "other_store" },
    { identifier: "custom.pro", reason: "other_store" },
    { identifier: "unpriced", reason: "no_price" },
    { identifier: "badprice", reason: "no_price" },
    { identifier: "negative", reason: "no_price" },
    { identifier: "x1", reason: "no_identifier" },
    { identifier: "", reason: "no_identifier" },
  ]);
});

test("the developer team is set only when one is given", () => {
  assert.deepEqual(written([MONTHLY], "T1").file.settings, { _developerTeamID: "T1" });
  assert.deepEqual(written([]).file, { identifier: "SUPERWALL", nonRenewingSubscriptions: [], products: [], settings: {}, subscriptionGroups: [], version: { major: 3, minor: 0 } });
});

test("products storekit --out writes the project's products there and says how many", async () => {
  const out = path.join(scratch(), "Test.storekit");
  const { calls } = await storekit({ out, project: "1" }, [MONTHLY]);
  const file = JSON.parse(fs.readFileSync(out, "utf8")) as Written;
  assert.deepEqual(file.subscriptionGroups[0]?.subscriptions.map((product) => product.productID), ["com.floatbrowse.pro.monthly"]);
  assert.deepEqual(said(calls, "success"), [`Wrote \`${out}\` with 1 product`]);
});

test("products storekit writes Superwall.storekit here by default, and --json says where", async () => {
  const dir = scratch();
  process.chdir(dir);
  const { result } = await storekit({ project: "1" }, [MONTHLY, YEARLY], true);
  assert.deepEqual(result.json, { path: "Superwall.storekit", products: 2, skipped: [] });
  assert.ok(fs.existsSync(path.join(dir, "Superwall.storekit")));

  const { calls } = await storekit({ project: "1" }, []);
  assert.deepEqual(said(calls, "success"), ["Wrote `Superwall.storekit` with 0 products"]);
});

const MIXED = [
  MONTHLY,
  { id: "a1", identifier: "play.pro:monthly", platform: "android", store: "play_store", price: USD(399) },
  { id: "s1", identifier: "live:price_1:none", platform: "stripe", price: USD(399) },
  { id: "n1", identifier: "unpriced", store: "app_store", price: null },
  { price: USD(100) },
];

test("products storekit warns about each product it left out, by reason", async () => {
  const out = path.join(scratch(), "Mixed.storekit");
  const { calls } = await storekit({ out, project: "1" }, MIXED);
  assert.deepEqual(said(calls, "success"), [`Wrote \`${out}\` with 1 product`]);
  assert.deepEqual(said(calls, "warn"), [
    "Left out 2 products not sold on the App Store: `play.pro:monthly`, `live:price_1:none`",
    "Left out 1 product with no price in Superwall: `unpriced`",
    "Left out 1 product with no store identifier",
  ]);

  const clean = await storekit({ out, project: "1" }, [MONTHLY, YEARLY]);
  assert.deepEqual(said(clean.calls, "warn"), []);
});

test("products storekit --json lists what it left out under skipped", async () => {
  const out = path.join(scratch(), "Mixed.storekit");
  const { result, calls } = await storekit({ out, project: "1" }, MIXED, true);
  assert.deepEqual(result.json, {
    path: out,
    products: 1,
    skipped: [
      { identifier: "play.pro:monthly", reason: "other_store" },
      { identifier: "live:price_1:none", reason: "other_store" },
      { identifier: "unpriced", reason: "no_price" },
      { identifier: "", reason: "no_identifier" },
    ],
  });
  assert.deepEqual(said(calls, "warn"), []);
});

test("skipped products with an id but no identifier are named by that id", () => {
  assert.deepEqual(describeSkipped([]), []);
  assert.deepEqual(describeSkipped([{ identifier: "x1", reason: "no_identifier" }, { identifier: "", reason: "no_identifier" }]), [
    "Left out 2 products with no store identifier: `x1`",
  ]);
});
