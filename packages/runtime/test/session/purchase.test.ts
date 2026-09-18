import { describe, expect, it } from "vitest";
import type { SuperwallConfig } from "../../src/config";
import { createSuperwallSession } from "../../src/session";
import { TestTransport, flushMicrotasks } from "../support/testTransport";

const createSession = (config?: SuperwallConfig) => {
  const transport = new TestTransport();
  const session = createSuperwallSession({ transport, config });
  session.start();
  return { session, transport };
};

const deliver = (transport: TestTransport, ...products: [string, string][]) => {
  transport.accept({
    event_name: "products",
    products: products.map(([product, productId]) => ({ product, productId })),
  });
};

describe("purchase outcomes", () => {
  it("resolves with the completing transaction and updates the snapshot", async () => {
    const { session, transport } = createSession();
    deliver(transport, ["primary", "pro_3999_year"]);

    const result = session.purchase("primary");
    expect(session.getSnapshot().pendingPurchase?.reference).toBe("primary");
    expect(transport.outgoing.at(-1)).toEqual({
      event_name: "purchase",
      product: "primary",
      product_identifier: "pro_3999_year",
    });

    transport.accept({ event_name: "transaction_complete", product: "primary" });

    await expect(result).resolves.toMatchObject({
      status: "completed",
      product: { reference: "primary" },
    });
    expect(session.getSnapshot().pendingPurchase).toBeUndefined();
    expect(session.getSnapshot().lastTransaction?.status).toBe("completed");
  });

  it("resolves as abandoned", async () => {
    const { session, transport } = createSession();
    const result = session.purchase("primary");
    transport.accept({ event_name: "transaction_abandon", product: "primary" });
    await expect(result).resolves.toMatchObject({ status: "abandoned" });
  });

  it("resolves as failed with reason sdk on transaction_fail and transaction_timeout", async () => {
    for (const event_name of ["transaction_fail", "transaction_timeout"] as const) {
      const { session, transport } = createSession();
      const result = session.purchase("primary");
      transport.accept({ event_name, product: "primary" });
      await expect(result).resolves.toMatchObject({ status: "failed", reason: "sdk" });
      expect(session.getSnapshot().pendingPurchase).toBeUndefined();
      expect(session.getSnapshot().lastPurchaseFailure?.reason).toBe("sdk");
    }
  });

  it("ignores a failure report for nothing that is pending", () => {
    const { session, transport } = createSession();
    transport.accept({ event_name: "transaction_fail", product: "primary" });
    expect(session.getSnapshot().lastPurchaseFailure).toBeUndefined();
  });

  it("reads dismissal from postPurchase — stay keeps the paywall, the rest dismiss", () => {
    const stay = createSession({ postPurchase: "stay" });
    stay.session.purchase("primary");
    expect(stay.transport.outgoing.at(-1)).toMatchObject({ should_dismiss: false });

    const redeem = createSession({ postPurchase: "redeem" });
    redeem.session.purchase("primary");
    expect(redeem.transport.outgoing.at(-1)).toMatchObject({ should_dismiss: true });

    // A per-call postPurchase overrides the config's.
    const { session, transport } = createSession({ postPurchase: "dismiss" });
    session.purchase("primary", { postPurchase: "stay" });
    expect(transport.outgoing.at(-1)).toMatchObject({ should_dismiss: false });

    // Nothing chosen anywhere: the flag is omitted and the SDK keeps its default.
    const bare = createSession();
    bare.session.purchase("primary");
    expect(bare.transport.outgoing.at(-1)).not.toHaveProperty("should_dismiss");
  });

  it("a failure for one product never touches a newer purchase of another", async () => {
    const { session, transport } = createSession();
    const first = session.purchase("primary");
    const second = session.purchase("secondary");

    transport.accept({ event_name: "transaction_fail", product: "primary" });

    await expect(first).resolves.toMatchObject({ status: "failed", reason: "sdk" });
    expect(session.getSnapshot().lastPurchaseFailure?.product.reference).toBe("primary");
    expect(session.getSnapshot().pendingPurchase?.reference).toBe("secondary");
    void second;
  });

  it("supersedes a previous pending purchase for the same product", async () => {
    const { session, transport } = createSession();
    const first = session.purchase("primary");
    const second = session.purchase("primary");

    await expect(first).resolves.toMatchObject({ status: "failed", reason: "superseded" });
    expect(session.getSnapshot().pendingPurchase?.reference).toBe("primary");
    expect(session.getSnapshot().lastPurchaseFailure).toBeUndefined();

    transport.accept({ event_name: "transaction_complete", product: "primary" });
    await expect(second).resolves.toMatchObject({ status: "completed" });
  });
});

describe("purchase attribution", () => {
  it("does not resolve a pending purchase from an unrelated transaction", async () => {
    const { session, transport } = createSession();
    deliver(transport, ["primary", "pro_year"], ["secondary", "pro_month"]);

    const purchase = session.purchase("primary");
    let settled = false;
    void purchase.then(() => {
      settled = true;
    });

    transport.accept({ event_name: "transaction_complete", product: "secondary" });
    await flushMicrotasks();

    expect(settled).toBe(false);
    expect(session.getSnapshot().pendingPurchase?.reference).toBe("primary");
    expect(session.getSnapshot().lastTransaction?.product.reference).toBe("secondary");

    transport.accept({ event_name: "transaction_complete", product: "primary" });
    await expect(purchase).resolves.toMatchObject({ status: "completed" });
  });

  it("attributes by store identifier, and a bare transaction to the single pending purchase", async () => {
    const { session, transport } = createSession();
    deliver(transport, ["primary", "store_year"]);

    const byIdentifier = session.purchase("primary");
    transport.accept({ event_name: "transaction_complete", product_identifier: "store_year" });
    await expect(byIdentifier).resolves.toMatchObject({
      status: "completed",
      product: { reference: "primary" },
    });

    const bare = session.purchase("primary");
    transport.accept({ event_name: "transaction_complete" });
    await expect(bare).resolves.toMatchObject({
      status: "completed",
      product: { reference: "primary" },
    });
  });

  it("records a transaction nothing was pending for against the product it names", async () => {
    const { session, transport } = createSession();
    deliver(transport, ["primary", "pid_year"]);

    const purchase = session.purchase("primary");
    transport.accept({ event_name: "transaction_complete", product_identifier: "other_product" });
    await flushMicrotasks();
    expect(session.getSnapshot().lastTransaction?.product.reference).toBe("other_product");
    expect(session.getSnapshot().pendingPurchase?.reference).toBe("primary");

    transport.accept({ event_name: "transaction_abandon", product: "primary" });
    await purchase;
    transport.accept({ event_name: "transaction_complete", product_identifier: "pid_year" });
    expect(session.getSnapshot().lastTransaction?.product.reference).toBe("primary");
    transport.accept({ event_name: "transaction_complete" });
    expect(session.getSnapshot().lastTransaction?.product.reference).toBe("unknown");
  });

  it("settles in-flight purchases when the paywall (re)opens", async () => {
    const { session, transport } = createSession();
    const purchase = session.purchase("primary");
    transport.accept({ event_name: "paywall_open", paywall_id: "pw_1", paywall_identifier: "pw" });

    await expect(purchase).resolves.toMatchObject({ status: "failed", reason: "superseded" });
    expect(session.getSnapshot().pendingPurchase).toBeUndefined();
    expect(session.getSnapshot().lastPurchaseFailure).toBeUndefined();
  });
});

describe("purchase identity across platforms", () => {
  const config: SuperwallConfig = {
    products: { annual: { ios: "pro_year", android: "pro_year_play" }, monthly: "pro_month" },
  };

  it("a purchase before the host speaks sends the id the config resolves", () => {
    const { session, transport } = createSession({ products: { annual: "pro_year_play" } });
    session.purchase("annual");
    expect(transport.outgoing.at(-1)).toMatchObject({
      product: "annual",
      product_identifier: "pro_year_play",
    });
    expect(session.getSnapshot().pendingPurchase?.product.source).toBe("inline");
  });

  it("an unbaked per-platform config resolves by the platform the device reports", () => {
    const { session, transport } = createSession(config);
    transport.accept({
      event_name: "template_variables",
      variables: { device: { platform: "Android" } },
    });
    session.purchase("annual");
    expect(transport.outgoing.at(-1)).toMatchObject({ product_identifier: "pro_year_play" });
  });

  it("never sends another platform's id: an ios device cannot name the play product", () => {
    const { session, transport } = createSession(config);
    transport.accept({
      event_name: "template_variables",
      variables: { device: { platform: "iOS" } },
    });
    session.purchase("annual");
    const sent = JSON.stringify(transport.outgoing);
    expect(sent).toContain("pro_year");
    expect(sent).not.toContain("pro_year_play");
  });

  it("the host's products always win over whatever the config said", () => {
    const { session, transport } = createSession({ products: { annual: "pro_year" } });
    deliver(transport, ["annual", "pro_year_play"]);
    session.purchase("annual");
    expect(transport.outgoing.at(-1)).toMatchObject({ product_identifier: "pro_year_play" });
  });

  it("a reference nothing declares is purchased by name alone", () => {
    const { session, transport } = createSession();
    session.purchase({ reference: "mystery" });
    expect(transport.outgoing.at(-1)).toEqual({ event_name: "purchase", product: "mystery" });
    expect(session.getSnapshot().pendingPurchase?.product.source).toBe("unknown");
  });
});
