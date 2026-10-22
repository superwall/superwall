import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MissingProductError,
  listProjectProducts,
  productVariables,
  projectForApplication,
  requireProducts,
} from "@/core/paywalls/products";
import { routedApi } from "../../helpers/routed-api";

test("derives the variables a paywall reads from what Superwall knows", () => {
  const variables = productVariables({
    identifier: "pro_5999_year",
    price: { amount: 5999, currency: "USD" },
    subscription: { period: "year", period_count: 1, trial_period_days: 7 },
  });

  assert.equal(variables.price, "$59.99");
  assert.equal(variables.rawPrice, 59.99);
  assert.equal(variables.period, "year");
  assert.equal(variables.periodly, "yearly");
  assert.equal(variables.monthlyPrice, "$5.00");
  assert.equal(variables.currencyCode, "USD");
  assert.equal(variables.currencySymbol, "$");
  assert.equal(variables.trialPeriodDays, 7);
  assert.equal(variables.trialPeriodText, "7-day");
});

test("invents nothing the dashboard cannot answer for", () => {
  const variables = productVariables({ identifier: "lifetime" });

  assert.equal(variables.identifier, "lifetime");
  assert.equal(variables.price, undefined);
  assert.equal(variables.period, undefined);
  assert.equal(variables.trialPeriodDays, undefined);
});

test("a product with no subscription keeps its price and gains no period", () => {
  const variables = productVariables({
    identifier: "tip",
    price: { amount: 499, currency: "EUR" },
  });

  assert.equal(variables.rawPrice, 4.99);
  assert.equal(variables.currencyCode, "EUR");
  assert.equal(variables.period, undefined);
  assert.equal(variables.monthlyPrice, undefined);
});

test("a monthly product derives its yearly equivalent, not the other way round", () => {
  const variables = productVariables({
    identifier: "pro_999_month",
    price: { amount: 999, currency: "USD" },
    subscription: { period: "month", period_count: 1 },
  });

  assert.equal(variables.monthlyPrice, "$9.99");
  assert.equal(variables.yearlyPrice, "$119.88");
});

test("publishing stops on a reference Superwall has no product for", () => {
  assert.throws(
    () =>
      requireProducts({ pro_5999_year: {} }, [
        { id: "plus", products: { annual: "pro_5999_year", monthly: "pro_999_month" } },
      ]),
    (error: Error) =>
      error instanceof MissingProductError && /plus: monthly → pro_999_month/.test(error.message),
  );
});

test("every gap is reported at once, across every selected paywall", () => {
  try {
    requireProducts({}, [
      { id: "a", products: { annual: "x" } },
      { id: "b", products: { monthly: "y" } },
    ]);
    assert.fail("expected a MissingProductError");
  } catch (error) {
    assert.match((error as Error).message, /a: annual → x/);
    assert.match((error as Error).message, /b: monthly → y/);
    assert.match((error as Error).message, /These 2 products/);
  }
});

test("a paywall that declares no products is never blocked", () => {
  assert.doesNotThrow(() => requireProducts({}, [{ id: "info", products: {} }, { id: "bare" }]));
});

test("the catalogue is keyed by store identifier and skips products without one", async () => {
  const { api, sent } = routedApi({
    "GET /v2/products?project_id=a%2Fb": [
      { identifier: "pro_999_month", price: { amount: 999, currency: "USD" } },
      { price: { amount: 100, currency: "USD" } },
    ],
  });

  const catalogue = await listProjectProducts(api, "a/b");

  assert.deepEqual(Object.keys(catalogue), ["pro_999_month"]);
  assert.equal(catalogue.pro_999_month?.price, "$9.99");
  assert.deepEqual(sent, [{ method: "GET", path: "/v2/products?project_id=a%2Fb" }]);
});

test("an app's project is found by the app id, and an app that can't be found has none", async () => {
  const { api } = routedApi({
    "GET /v2/projects": [{ id: 9, applications: [{ id: 42, name: "Acme" }] }],
  });

  assert.equal(await projectForApplication(api, "42"), "9");
  assert.equal(await projectForApplication(api, "43"), undefined);
});
