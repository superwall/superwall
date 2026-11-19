import { describe, expect, it } from "vitest";

const stripeScripts = () =>
  Array.from(document.querySelectorAll("script")).filter((script) =>
    script.src.includes("js.stripe.com"),
  );

describe("a paywall that never takes payment", () => {
  it("loads no Stripe.js when it imports the framework's entries", async () => {
    await import("../../../src/hooks");
    await import("../../../src/checkout");
    await import("../../../src/checkout/flow");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stripeScripts()).toEqual([]);
  });
});
