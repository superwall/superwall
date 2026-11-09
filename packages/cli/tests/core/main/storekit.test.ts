import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { command as products } from "@/commands/main/products";
import { buildStoreKit, generateStoreKit } from "@/core/main/storekit";
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

/** App 51796's three App Store subscriptions, as `GET /v2/products` returns them. */
const LINEUP = JSON.parse(
  fs.readFileSync(new URL("../../fixtures/storekit/lineup-products.json", import.meta.url), "utf8"),
) as Record<string, unknown>[];

/** A StoreKit configuration Xcode 26.4 wrote (format 5.0), reduced to one product of each kind. */
const XCODE = JSON.parse(
  fs.readFileSync(new URL("../../fixtures/storekit/xcode-26.storekit", import.meta.url), "utf8"),
) as StoreKitFile;

interface Offer {
  billingPlanType: string;
  displayPrice?: string;
  internalID: string;
  numberOfPeriods: number;
  paymentMode: string;
  subscriptionPeriod: string;
}
interface Plan {
  billingPlanType: string;
  commitmentDisplayPrice: string;
  displayPrice: string;
}
interface Subscription {
  productID: string;
  displayPrice: string;
  groupNumber: number;
  recurringSubscriptionPeriod: string;
  subscriptionGroupID: string;
  type: string;
  introductoryOffers: Offer[];
  billingPlans: Plan[];
  localizations: { displayName: string }[];
}
interface Product {
  productID: string;
  displayPrice: string;
  type: string;
  internalID: string;
  localizations: { description: string; displayName: string; locale: string }[];
}
interface StoreKitFile {
  identifier: string;
  products: Product[];
  nonRenewingSubscriptions: Product[];
  subscriptionGroups: { id: string; name: string; subscriptions: Subscription[] }[];
  settings: Record<string, unknown>;
  version: unknown;
}

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sw-storekit-"));
}

async function storekit(flags: Record<string, unknown>, rows: unknown[], json = false) {
  const { api } = routedApi({ "GET /v2/projects": [PROJECT], "GET /v2/products?project_id=1": rows });
  const calls: RendererCall[] = [];
  const result = await runCommand(products, { words: ["storekit"], flags, json, api, renderer: recordingRenderer(calls) });
  return { result, calls };
}

const file = (rows: Record<string, unknown>[], groupName?: string) =>
  generateStoreKit(rows, groupName === undefined ? {} : { groupName }) as unknown as StoreKitFile;

const sub = (overrides: Record<string, unknown> = {}, subscription: Record<string, unknown> = {}) => ({
  identifier: "pro",
  platform: "ios",
  store: "app_store",
  price: { amount: 999, currency: "USD" },
  subscription: { period: "month", period_count: 1, trial_period_days: null, ...subscription },
  ...overrides,
});

function keysOf(value: unknown): string[] {
  return Object.keys(value as object).sort();
}

test("App Store subscriptions land in a subscription group with their period, price and trial (FeedbackRequest #1)", () => {
  const sk = file(LINEUP, "Lineup");
  assert.deepEqual(sk.products, []);
  assert.equal(sk.subscriptionGroups.length, 1);
  const [group] = sk.subscriptionGroups;
  assert.equal(group?.name, "Lineup");
  assert.deepEqual(
    group?.subscriptions.map((s) => [s.productID, s.type, s.recurringSubscriptionPeriod, s.displayPrice, s.subscriptionGroupID === group.id]),
    [
      ["lineup_pro_monthly", "RecurringSubscription", "P1M", "8.99", true],
      ["lineup_pro_yearly", "RecurringSubscription", "P1Y", "74.99", true],
      ["lineup_pro_weekly", "RecurringSubscription", "P1W", "2.39", true],
    ],
  );
  const yearly = group?.subscriptions[1];
  assert.deepEqual(
    yearly?.introductoryOffers.map(({ internalID: _, ...offer }) => offer),
    [{ billingPlanType: "BILLED_UPFRONT", numberOfPeriods: 1, paymentMode: "free", subscriptionPeriod: "P1W" }],
  );
  assert.deepEqual(group?.subscriptions[0]?.introductoryOffers, []);
  assert.deepEqual(group?.subscriptions[0]?.localizations[0]?.displayName, "Lineup Pro Monthly");
  assert.deepEqual(yearly?.billingPlans.map((plan) => [plan.billingPlanType, plan.displayPrice]), [["BILLED_UPFRONT", "74.99"]]);
  assert.deepEqual(sk.version, { major: 5, minor: 0 });
});

test("the file has every field Xcode 26 writes, object by object", () => {
  const sk = file(
    [
      sub({ monthly_billing_plan_price: { amount: 99, currency: "USD" } }, { trial_period_days: 7 }),
      { identifier: "com.example.lifetime", platform: "ios", price: { amount: 499, currency: "USD" }, subscription: null },
    ],
    "Pro",
  );
  const ours = sk.subscriptionGroups[0]!;
  const theirs = XCODE.subscriptionGroups[0]!;
  assert.deepEqual(keysOf(sk), keysOf(XCODE));
  assert.deepEqual(keysOf(sk.settings), keysOf(XCODE.settings));
  assert.deepEqual(keysOf(ours), keysOf(theirs));
  assert.deepEqual(keysOf(ours.subscriptions[0]), keysOf(theirs.subscriptions[0]));
  assert.deepEqual(keysOf(ours.subscriptions[0]?.introductoryOffers[0]), keysOf(theirs.subscriptions[0]?.introductoryOffers[0]));
  assert.deepEqual(ours.subscriptions[0]?.billingPlans.map(keysOf), theirs.subscriptions[0]?.billingPlans.map(keysOf));
  assert.deepEqual(keysOf(sk.products[0]), keysOf(XCODE.products[0]));
  assert.deepEqual(sk.version, XCODE.version);
  for (const id of [sk.identifier, ours.id, sk.products[0]!.internalID]) assert.match(id, /^[0-9A-F]{8}$/);
});

test("an annual plan with a monthly price in Superwall gets Apple's monthly billing plan", () => {
  const sk = file([sub({ price: { amount: 1000, currency: "USD" }, monthly_billing_plan_price: { amount: 99, currency: "USD" } }, { period: "year" })]);
  assert.deepEqual(
    sk.subscriptionGroups[0]?.subscriptions[0]?.billingPlans.map(({ billingPlanType, commitmentDisplayPrice, displayPrice }) => [billingPlanType, commitmentDisplayPrice, displayPrice]),
    [
      ["BILLED_UPFRONT", "10.00", "10.00"],
      ["MONTHLY", "11.88", "0.99"],
    ],
  );
  const yen = file([sub({ price: { amount: 12000, currency: "JPY" }, monthly_billing_plan_price: { amount: 1100, currency: "JPY" } }, { period: "year" })]);
  assert.deepEqual(yen.subscriptionGroups[0]?.subscriptions[0]?.billingPlans.map((plan) => plan.commitmentDisplayPrice), ["12000", "13200"]);
});

test("a paid trial price is a first period paid up front; an explicit offer names its mode", () => {
  const offerOf = (overrides: Record<string, unknown>, subscription: Record<string, unknown>) => {
    const [offer] = file([sub(overrides, subscription)]).subscriptionGroups[0]?.subscriptions[0]?.introductoryOffers ?? [];
    if (!offer) return undefined;
    const { internalID: _, billingPlanType: __, ...rest } = offer;
    return rest;
  };
  assert.deepEqual(offerOf({ trial_price: { amount: 199, currency: "USD" } }, { trial_period_days: 30 }), {
    displayPrice: "1.99",
    numberOfPeriods: 1,
    paymentMode: "payUpFront",
    subscriptionPeriod: "P1M",
  });
  assert.deepEqual(offerOf({ trial_price: { amount: 299, currency: "USD" } }, { introductory_offer: { type: "pay_as_you_go", duration_days: 90 } }), {
    displayPrice: "2.99",
    numberOfPeriods: 3,
    paymentMode: "payAsYouGo",
    subscriptionPeriod: "P1M",
  });
  assert.deepEqual(offerOf({}, { introductory_offer: { type: "pay_up_front", duration_days: 180 } }), {
    displayPrice: "0.00",
    numberOfPeriods: 1,
    paymentMode: "payUpFront",
    subscriptionPeriod: "P6M",
  });
  assert.deepEqual(offerOf({ trial_price: { amount: 199, currency: "USD" } }, { introductory_offer: { type: "free_trial", duration_days: 3 } }), {
    numberOfPeriods: 1,
    paymentMode: "free",
    subscriptionPeriod: "P3D",
  });
  assert.deepEqual(offerOf({}, { trial_period_days: 365 }), { numberOfPeriods: 1, paymentMode: "free", subscriptionPeriod: "P1Y" });
  assert.deepEqual(offerOf({}, { trial_period_days: 60 }), { numberOfPeriods: 1, paymentMode: "free", subscriptionPeriod: "P2M" });
  assert.deepEqual(offerOf({}, { trial_period_days: 14 }), { numberOfPeriods: 1, paymentMode: "free", subscriptionPeriod: "P2W" });
  assert.deepEqual(offerOf({}, { trial_period_days: 5 }), { numberOfPeriods: 1, paymentMode: "free", subscriptionPeriod: "P5D" });
  assert.equal(offerOf({}, { trial_period_days: 0 }), undefined);
  assert.equal(offerOf({}, { period: "bogus", introductory_offer: { type: "pay_as_you_go", duration_days: 30 } }), undefined);
});

test("periods follow ISO 8601 as Xcode writes them", () => {
  const periodOf = (subscription: Record<string, unknown>) =>
    file([sub({}, subscription)]).subscriptionGroups[0]?.subscriptions[0]?.recurringSubscriptionPeriod;
  assert.equal(periodOf({ period: "month", period_count: 3 }), "P3M");
  assert.equal(periodOf({ period: "month", period_count: 12 }), "P1Y");
  assert.equal(periodOf({ period: "day", period_count: 7 }), "P1W");
  assert.equal(periodOf({ period: "day", period_count: 3 }), "P3D");
  assert.equal(periodOf({ period: "week", period_count: "x" }), "P1W");
  assert.equal(periodOf({ period: "fortnight" }), undefined);
});

test("one-time purchases stay in products, and App Store Connect's type wins when the API sends it", () => {
  const info = (type: string) => ({ app_store_info: { in_app_purchase_type: type, state: "APPROVED", reference_name: "", product_id: "" } });
  const sk = file([
    { identifier: "lifetime", platform: "ios", price: { amount: 2999, currency: "USD" }, subscription: null },
    { identifier: "coins", platform: "ios", price: { amount: 99, currency: "USD" }, subscription: null, ...info("CONSUMABLE") },
    { identifier: "unlock", platform: "ios", price: { amount: 499, currency: "USD" }, subscription: null, ...info("NON_CONSUMABLE") },
    { identifier: "season", platform: "ios", price: { amount: 999, currency: "USD" }, subscription: null, ...info("NON_RENEWING_SUBSCRIPTION") },
    sub({ identifier: "monthly", ...info("AUTOMATICALLY_RENEWABLE_SUBSCRIPTION") }),
    sub({ identifier: "renewable-no-period", subscription: null, ...info("AUTO_RENEWABLE_SUBSCRIPTION") }),
    sub({ identifier: "iap", ...info("IN_APP_PURCHASE") }),
  ]);
  assert.deepEqual(sk.products.map((p) => [p.productID, p.type, p.displayPrice]), [
    ["lifetime", "NonConsumable", "29.99"],
    ["coins", "Consumable", "0.99"],
    ["unlock", "NonConsumable", "4.99"],
    ["renewable-no-period", "NonConsumable", "9.99"],
  ]);
  assert.deepEqual(sk.nonRenewingSubscriptions.map((p) => [p.productID, p.type]), [["season", "NonRenewingSubscription"]]);
  assert.deepEqual(sk.subscriptionGroups[0]?.subscriptions.map((s) => s.productID), ["monthly", "iap"]);
});

test("products of other stores are left out, and unpriced ones are counted", () => {
  const built = buildStoreKit([
    sub({ identifier: "ios" }),
    sub({ identifier: "play", platform: "android", store: "play_store" }),
    sub({ identifier: "web", platform: "stripe", store: undefined }),
    sub({ identifier: "nostore", store: undefined, platform: undefined, price: null }),
    sub({ identifier: "ios", price: { amount: 1, currency: "USD" } }),
    sub({ identifier: "bad-price", price: { amount: -1, currency: "USD" } }),
    sub({ identifier: "odd-currency", price: { amount: 1234, currency: "NOPE" } }),
    sub({ identifier: "no-currency", price: { amount: 500 } }),
  ]);
  const groups = built.file.subscriptionGroups as StoreKitFile["subscriptionGroups"];
  assert.deepEqual(groups[0]?.subscriptions.map((s) => [s.productID, s.displayPrice]), [
    ["ios", "9.99"],
    ["nostore", "0.00"],
    ["bad-price", "0.00"],
    ["odd-currency", "12.34"],
    ["no-currency", "5.00"],
  ]);
  assert.deepEqual(built.skipped, ["play", "web"]);
  assert.deepEqual(built.unpriced, ["nostore", "bad-price"]);
  assert.deepEqual(built.counts, { total: 5, subscriptions: 5 });
});

test("a StoreKit file lists each product once, by its store identifier, and its ids are stable", () => {
  const rows = [
    { id: "p1", identifier: "pro_monthly" },
    { id: "p2", product_identifier: "pro_yearly" },
    { id: "p3", name: "Lifetime" },
    { id: "p4" },
    { id: "p5", identifier: "pro_monthly" },
  ];
  const sk = file(rows);
  assert.deepEqual(sk.products.map((product) => product.productID), ["pro_monthly", "pro_yearly", "Lifetime"]);
  assert.deepEqual(sk.products[0]?.localizations, [{ description: "", displayName: "pro_monthly", locale: "en_US" }]);
  assert.deepEqual(file(rows).products.map((p) => p.internalID), sk.products.map((p) => p.internalID));
  assert.equal(new Set(sk.products.map((p) => p.internalID)).size, 3);
  assert.deepEqual(sk.subscriptionGroups, []);
  assert.equal(file([sub()], "  ").subscriptionGroups[0]?.name, "Subscriptions");
});

test("products storekit --out writes the project's products there and says how many", async () => {
  const out = path.join(scratch(), "Test.storekit");
  const { calls } = await storekit({ out, project: "1" }, [
    { id: "p1", identifier: "pro", platform: "ios", price: { amount: 999, currency: "USD" } },
  ]);
  const written = JSON.parse(fs.readFileSync(out, "utf8")) as StoreKitFile;
  assert.deepEqual(written.products.map((product) => product.productID), ["pro"]);
  assert.deepEqual(said(calls, "success"), [`Wrote \`${out}\` with 1 product`]);
  assert.deepEqual(said(calls, "warn"), []);
});

test("products storekit writes a project's App Store subscriptions into its group", async () => {
  const out = path.join(scratch(), "Lineup.storekit");
  const { calls } = await storekit({ out, project: "1" }, [
    ...LINEUP,
    { identifier: "play_pro", platform: "android", store: "play_store", price: null },
    { identifier: "free_thing", platform: "ios", price: null },
  ]);
  const written = JSON.parse(fs.readFileSync(out, "utf8")) as StoreKitFile;
  assert.equal(written.subscriptionGroups[0]?.name, "Lab");
  assert.equal(written.subscriptionGroups[0]?.subscriptions.length, 3);
  assert.deepEqual(said(calls, "success"), [`Wrote \`${out}\` with 4 products, 3 of them auto-renewable`]);
  assert.deepEqual(said(calls, "warn"), ["Superwall has no price for free_thing: written at 0.00, so set it in Xcode."]);
  assert.deepEqual(said(calls, "info").filter((line) => line.startsWith("Left out")), ["Left out 1 product of other stores: play_pro."]);

  const two = await storekit({ out, project: "1" }, [
    { identifier: "a", platform: "android" },
    { identifier: "b", platform: "stripe" },
  ]);
  assert.deepEqual(said(two.calls, "info").filter((line) => line.startsWith("Left out")), ["Left out 2 products of other stores: a, b."]);
});

test("products storekit writes Superwall.storekit here by default, and --json says where", async () => {
  const dir = scratch();
  process.chdir(dir);
  const { result } = await storekit({ project: "1" }, [{ identifier: "a" }, { identifier: "b" }], true);
  assert.deepEqual(result.json, { path: "Superwall.storekit", products: 2, subscriptions: 0, unpriced: ["a", "b"] });
  assert.ok(fs.existsSync(path.join(dir, "Superwall.storekit")));

  const lineup = await storekit({ project: "1" }, [...LINEUP, { identifier: "web", platform: "stripe" }], true);
  assert.deepEqual(lineup.result.json, { path: "Superwall.storekit", products: 3, subscriptions: 3, skipped: ["web"] });

  const { calls } = await storekit({ project: "1" }, []);
  assert.deepEqual(said(calls, "success"), ["Wrote `Superwall.storekit` with 0 products"]);
});
