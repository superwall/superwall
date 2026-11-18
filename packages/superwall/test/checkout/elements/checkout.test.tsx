import { act, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SuperwallCheckoutConfig,
  SuperwallProduct,
  TOutgoingMessage,
} from "@superwall/runtime";
import type { SuperwallHost } from "../../../src/host";
import type { ElementsCheckoutSession } from "../../../src/checkout/types";

const stripe = vi.hoisted(() => {
  const form = { submit: vi.fn() };
  const client = {
    createPaymentMethod: vi.fn(),
    confirmCardPayment: vi.fn(),
    confirmCardSetup: vi.fn(),
  };
  return {
    form,
    client,
    loadStripe: vi.fn(async () => client),
    elements: [] as { stripe: unknown; options: unknown }[],
    express: undefined as
      | undefined
      | {
          onClick: (event: { resolve: () => void; reject: () => void }) => void;
          onConfirm: (event: { paymentFailed: (payload?: unknown) => void }) => Promise<void>;
          onCancel: () => void;
          options?: unknown;
        },
  };
});

const host = vi.hoisted(() => ({ current: "web-paywall" as SuperwallHost }));

vi.mock("@stripe/stripe-js", () => ({ loadStripe: stripe.loadStripe }));
vi.mock("@stripe/react-stripe-js", async () => {
  const React = await import("react");
  const Context = React.createContext<unknown>(null);
  return {
    Elements: ({
      stripe: client,
      options,
      children,
    }: React.PropsWithChildren<{ stripe: unknown; options?: unknown }>) => {
      stripe.elements.push({ stripe: client, options });
      return React.createElement(Context.Provider, { value: client }, children);
    },
    useStripe: () => React.useContext(Context),
    useElements: () => (React.useContext(Context) ? stripe.form : null),
    ExpressCheckoutElement: (props: NonNullable<typeof stripe.express>) => {
      stripe.express = props;
      return null;
    },
    PaymentElement: () => null,
    AddressElement: () => null,
    LinkAuthenticationElement: () => null,
    PaymentMethodMessagingElement: () => null,
  };
});
vi.mock("../../../src/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/host")>()),
  hostOf: () => host.current,
}));

const { Checkout, ExpressCheckoutElement, PurchaseButton, useCheckout } =
  await import("../../../src/checkout");
const { SuperwallProvider } = await import("../../../src");
const { useSuperwallSession, usePurchase } = await import("../../../src/hooks");
const { elementsFor, sessionsFor, watchCompletedCheckouts } =
  await import("../../../src/checkout/flow");
const { amountsOf, elementsOptionsOf, intentTypeOf } =
  await import("../../../src/checkout/elements/Checkout");
const { createHost, testConfig } = await import("../../helpers");

type Session = ReturnType<typeof useSuperwallSession>;

const products = [
  { reference: "primary", productId: "test:price_1:no-trial" },
  { reference: "secondary", productId: "test:price_2:no-trial" },
  { reference: "store", productId: "pro_999_month" },
];

const quote = (overrides: Partial<ElementsCheckoutSession> = {}): ElementsCheckoutSession => ({
  directive: "elements",
  checkoutSessionId: null,
  publishableKey: "pk_test_123",
  checkoutContextId: "ctx_1",
  referenceName: "primary",
  subscriptionDetails: { amount: 1999, currency: "USD", interval: "month", intervalCount: 1 },
  intentType: "PaymentIntent",
  ...overrides,
});

const answerConfirm = (body: unknown, status = 200) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );

const settle = () =>
  act(async () => {
    for (let index = 0; index < 6; index += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
  });

const held = () => {
  const latch: { resolve?: (value: unknown) => void } = {};
  const promise = new Promise<unknown>((resolve) => {
    latch.resolve = resolve;
  });
  return { promise, release: () => latch.resolve?.({}) };
};

type Seen = { checkout?: ReturnType<typeof useCheckout>; session?: Session };

const Probe = ({ seen }: { seen: Seen }) => {
  seen.checkout = useCheckout();
  return null;
};

const SessionProbe = ({ seen }: { seen: Seen }) => {
  seen.session = useSuperwallSession();
  return null;
};

type Mount = {
  checkout?: SuperwallCheckoutConfig;
  device?: Record<string, unknown>;
  product?: string | SuperwallProduct;
  prepare?: ElementsCheckoutSession | null;
  props?: Record<string, unknown>;
  children?: React.ReactNode;
};

const mount = async ({
  checkout = "elements",
  device = {},
  product = "primary",
  prepare = quote(),
  props = {},
  children,
}: Mount = {}) => {
  const outgoing: TOutgoingMessage[] = [];
  const { transport } = createHost({
    products,
    device: {
      platform: "web",
      publicApiKey: "pk_test",
      sdkVersionPadded: "004.014.000",
      ...device,
    },
    onOutgoing: (message) => outgoing.push(message),
  });
  const seen: Seen = {};
  const config = { ...testConfig, checkout };
  const tree = (node: React.ReactNode) => (
    <SuperwallProvider config={config} transport={transport}>
      <SessionProbe seen={seen} />
      {node}
    </SuperwallProvider>
  );
  const form = (name: string | SuperwallProduct) => (
    <Checkout product={name} {...props}>
      <Probe seen={seen} />
      {children}
    </Checkout>
  );
  const rendered = render(tree(null));
  await settle();
  const session = seen.session as Session;
  watching.push(watchCompletedCheckouts(session));
  const prefetch = vi.spyOn(sessionsFor(session), "prefetch");
  if (prepare === null) prefetch.mockReturnValue(new Promise(() => undefined));
  else prefetch.mockResolvedValue(prepare);
  rendered.rerender(tree(form(product)));
  await settle();
  const names = () =>
    outgoing
      .map((message) => (message as { event_name?: string }).event_name)
      .filter((name): name is string => typeof name === "string" && name.startsWith("stripe_"))
      .filter(
        (name) => name !== "stripe_checkout_diagnostic" && name !== "stripe_checkout_prefetch",
      );
  return {
    seen,
    session,
    outgoing,
    prefetch,
    names,
    switchTo: async (name: string) => {
      rendered.rerender(tree(form(name)));
      await settle();
    },
    checkout: () => seen.checkout as NonNullable<Seen["checkout"]>,
  };
};

const watching: (() => void)[] = [];

beforeEach(() => {
  host.current = "web-paywall";
  stripe.elements.length = 0;
  stripe.express = undefined;
  stripe.form.submit.mockResolvedValue({});
  stripe.client.createPaymentMethod.mockResolvedValue({
    paymentMethod: { id: "pm_1", billing_details: { email: "shopper@example.com" } },
  });
});

afterEach(() => {
  for (const stop of watching.splice(0)) stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("<Checkout> before it can take payment", () => {
  it.each<[SuperwallHost, string]>([
    ["studio", "web"],
    ["ios-sdk", "iOS"],
  ])("is unavailable on %s, without asking for a price", async (name, platform) => {
    host.current = name;
    const { checkout, prefetch } = await mount({ device: { platform } });
    expect(checkout()).toMatchObject({
      status: "unavailable",
      reason: "unsupported_host",
      canSubmit: false,
      message: expect.stringContaining("iOS app"),
    });
    expect(prefetch).not.toHaveBeenCalled();
    expect(stripe.elements.at(-1)).toEqual({ stripe: null, options: undefined });
  });

  it("is unavailable when the config sends shoppers to the hosted checkout", async () => {
    const { checkout } = await mount({ checkout: "external" });
    expect(checkout()).toMatchObject({ status: "unavailable", reason: "external_checkout" });
  });

  it("is unavailable without a public API key", async () => {
    const { checkout } = await mount({ device: { publicApiKey: "" } });
    expect(checkout()).toMatchObject({ status: "unavailable", reason: "missing_public_api_key" });
  });

  it("is unavailable for a product the paywall doesn't have, or one Stripe doesn't sell", async () => {
    expect((await mount({ product: "missing" })).checkout()).toMatchObject({
      reason: "unknown_product",
    });
    const missing = await mount({ product: "missing" });
    let result: unknown;
    await act(async () => {
      result = await missing.checkout().submit();
    });
    expect(result).toEqual({ status: "unavailable", reason: "unknown_product" });
    expect((await mount({ product: "store" })).checkout()).toMatchObject({
      reason: "not_stripe_product",
      product: { reference: "store" },
    });
  });

  it("is preparing while the price loads, and submit() pays nothing", async () => {
    const { checkout, prefetch } = await mount({ prepare: null });
    expect(prefetch).toHaveBeenCalledWith(
      expect.objectContaining({ referenceName: "primary", mode: "elements" }),
    );
    expect(checkout()).toMatchObject({ status: "preparing", canSubmit: false });
    expect(checkout().reason).toBeUndefined();
    let result: unknown;
    await act(async () => {
      result = await checkout().submit();
    });
    expect(result).toEqual({
      status: "unavailable",
      reason: "preparing",
      product: expect.objectContaining({ reference: "primary" }),
    });
  });

  it("names the store's reason and error when the price fails to load", async () => {
    const { checkout, session } = await mount({ prepare: null });
    act(() => elementsFor(session).markUnavailable("primary", "session_failed", new Error("down")));
    expect(checkout()).toMatchObject({
      status: "unavailable",
      reason: "session_failed",
      error: { name: "Error", message: "down" },
    });
    let result: unknown;
    await act(async () => {
      result = await checkout().submit();
    });
    expect(result).toMatchObject({ status: "unavailable", reason: "session_failed" });
  });

  it("throws a clear error when used outside <Checkout>", () => {
    const Lonely = () => {
      useCheckout();
      return null;
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Lonely />)).toThrow("useCheckout() must be rendered inside <Checkout>.");
  });
});

describe("<Checkout> once the price has loaded", () => {
  it("renders Stripe's elements in deferred mode with the product's price", async () => {
    const { checkout } = await mount({ props: { options: { appearance: { theme: "night" } } } });
    expect(checkout()).toMatchObject({
      status: "ready",
      canSubmit: true,
      intentType: "PaymentIntent",
      amounts: { currency: "usd", dueNow: 1999, recurring: 1999, interval: "month" },
    });
    expect(stripe.elements.at(-1)).toEqual({
      stripe: stripe.client,
      options: {
        mode: "subscription",
        amount: 1999,
        currency: "usd",
        paymentMethodCreation: "manual",
        paymentMethodTypes: ["card", "link"],
        appearance: { theme: "night" },
      },
    });
  });

  it("takes the product as a product as well as a reference", async () => {
    const { checkout } = await mount({
      product: {
        reference: "primary",
        productId: "test:price_1:no-trial",
        variables: {},
        source: "sdk",
      },
    });
    expect(checkout()).toMatchObject({ status: "ready", product: { reference: "primary" } });
  });

  it("keeps the form mounted while another product's price loads", async () => {
    const { checkout, switchTo, prefetch } = await mount();
    prefetch.mockReturnValue(new Promise(() => undefined));
    await switchTo("secondary");
    expect(checkout()).toMatchObject({ status: "preparing", canSubmit: false });
    expect(checkout().amounts).toBeUndefined();
    expect(stripe.elements.at(-1)?.stripe).toBe(stripe.client);
  });

  it("pays with the card, reports every callback and the SDK's messages, and passes the options on", async () => {
    answerConfirm({ subscriptionId: "sub_1" });
    const own = {
      onStart: vi.fn(),
      onSubmit: vi.fn(),
      onComplete: vi.fn(),
      onAbandon: vi.fn(),
      onFailure: vi.fn(),
    };
    const { checkout, names } = await mount({ props: own });
    let result: unknown;
    await act(async () => {
      result = await checkout().submit();
    });
    await settle();

    expect(result).toEqual({
      status: "completed",
      product: expect.objectContaining({ reference: "primary" }),
    });
    expect(stripe.form.submit).toHaveBeenCalledOnce();
    expect(stripe.client.createPaymentMethod).toHaveBeenCalledWith({ elements: stripe.form });
    const request = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
      paymentMethodId: "pm_1",
      email: "shopper@example.com",
    });
    for (const callback of [own.onStart, own.onSubmit, own.onComplete]) {
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ reference: "primary" }));
    }
    expect(own.onAbandon).not.toHaveBeenCalled();
    expect(own.onFailure).not.toHaveBeenCalled();
    expect(names()).toEqual([
      "stripe_checkout_start",
      "stripe_checkout_submit",
      "stripe_checkout_complete",
    ]);
    expect(checkout()).toMatchObject({ status: "ready", canSubmit: true });
  });

  it("starts no purchase while the form is incomplete", async () => {
    stripe.form.submit.mockResolvedValue({
      error: { type: "validation_error", message: "Your card number is incomplete." },
    });
    const onStart = vi.fn();
    const { checkout, names } = await mount({ props: { onStart } });
    let result: unknown;
    await act(async () => {
      result = await checkout().submit();
    });
    expect(result).toEqual({
      status: "incomplete",
      product: expect.objectContaining({ reference: "primary" }),
      error: { name: "validation_error", message: "Your card number is incomplete." },
    });
    expect(onStart).not.toHaveBeenCalled();
    expect(names()).toEqual([]);
    expect(checkout().canSubmit).toBe(true);
  });

  it("keeps an incomplete form's error message empty when Stripe gives none", async () => {
    stripe.form.submit.mockResolvedValue({ error: { type: "validation_error" } });
    const { checkout } = await mount();
    let result: unknown;
    await act(async () => {
      result = await checkout().submit();
    });
    expect(result).toMatchObject({ error: { message: "" } });
  });

  it("reports Stripe refusing to read the form as incomplete, and lets the next submit pay", async () => {
    answerConfirm({ subscriptionId: "sub_1" });
    stripe.form.submit.mockRejectedValueOnce(
      Object.assign(new Error("No PaymentElement is mounted."), { name: "IntegrationError" }),
    );
    stripe.form.submit.mockResolvedValue({});
    const { checkout, names } = await mount();
    let first: unknown;
    let second: unknown;
    await act(async () => {
      first = await checkout().submit();
    });
    await act(async () => {
      second = await checkout().submit();
    });
    expect(first).toEqual({
      status: "incomplete",
      product: expect.objectContaining({ reference: "primary" }),
      error: { name: "IntegrationError", message: "No PaymentElement is mounted." },
    });
    expect(second).toMatchObject({ status: "completed" });
    expect(names()).toEqual([
      "stripe_checkout_start",
      "stripe_checkout_submit",
      "stripe_checkout_complete",
    ]);
  });

  it("reports a decline as a failure, keeps the form open and shows it in usePurchase().failure", async () => {
    stripe.client.createPaymentMethod.mockResolvedValue({
      error: { code: "card_declined", decline_code: "insufficient_funds", message: "No funds." },
    });
    const onFailure = vi.fn();
    const seenPurchase: { failure?: unknown } = {};
    const Purchases = () => {
      seenPurchase.failure = usePurchase().failure;
      return null;
    };
    const { checkout, names } = await mount({ props: { onFailure }, children: <Purchases /> });
    let result: unknown;
    await act(async () => {
      result = await checkout().submit();
    });
    const failure = {
      reason: "insufficient_funds",
      store: "stripe",
      code: "card_declined",
      declineCode: "insufficient_funds",
      message: "No funds.",
    };
    expect(result).toEqual({
      status: "failed",
      failure,
      product: expect.objectContaining({ reference: "primary" }),
    });
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ ...failure, status: "failed" }),
    );
    expect(checkout()).toMatchObject({ status: "ready", canSubmit: true, failure });
    expect(seenPurchase.failure).toMatchObject(failure);
    expect(names()).toEqual(["stripe_checkout_start", "stripe_checkout_fail"]);
  });

  it("refuses a second submit while the first is paying", async () => {
    answerConfirm({ subscriptionId: "sub_1" });
    const { promise, release } = held();
    stripe.form.submit.mockReturnValue(promise);
    const { checkout } = await mount();
    let first: Promise<unknown> = Promise.resolve();
    let second: unknown;
    await act(async () => {
      first = checkout().submit();
      second = await checkout().submit();
    });
    expect(second).toMatchObject({ status: "unavailable", reason: "paying" });
    await act(async () => {
      release();
      await first;
    });
    await expect(first).resolves.toMatchObject({ status: "completed" });
  });

  it("sends postPurchase and stripeMetadata with the purchase", async () => {
    answerConfirm({ subscriptionId: "sub_1" });
    const { checkout, session, outgoing } = await mount({
      device: { sdkVersionPadded: "004.014.000" },
      props: { stripeMetadata: { campaign: "spring" }, postPurchase: "redeem" },
    });
    const attach = vi.spyOn(sessionsFor(session), "attachMetadata").mockResolvedValue(undefined);
    await act(async () => {
      await checkout().submit();
    });
    await settle();
    expect(attach).toHaveBeenCalledWith("ctx_1", { campaign: "spring" });
    expect(outgoing).toContainEqual(
      expect.objectContaining({
        event_name: "stripe_checkout_complete",
        post_purchase_resolution: { type: "redeem" },
      }),
    );
  });
});

describe("intent and options for each price", () => {
  it("uses a SetupIntent in setup mode for a free trial", () => {
    const trial = quote({
      intentType: "SetupIntent",
      subscriptionDetails: {
        amount: 4999,
        currency: "eur",
        interval: "year",
        intervalCount: 1,
        trialPeriodDays: 7,
      },
    });
    expect(amountsOf(trial)).toEqual({
      currency: "eur",
      dueNow: 0,
      recurring: 4999,
      interval: "year",
      intervalCount: 1,
      trialDays: 7,
    });
    expect(elementsOptionsOf(trial)).toEqual({
      mode: "setup",
      currency: "eur",
      setupFutureUsage: "off_session",
      paymentMethodCreation: "manual",
      paymentMethodTypes: ["card", "link"],
    });
  });

  it("charges the discounted amount and reports the discount", () => {
    const discount = { code: "SPRING", promotionCodeId: "promo_1", couponId: "co_1" };
    const discounted = quote({
      subscriptionDetails: {
        amount: 2000,
        discountedAmount: 1000,
        currency: "usd",
        interval: "month",
        intervalCount: 1,
        discount,
      },
    });
    expect(amountsOf(discounted)).toMatchObject({ dueNow: 1000, recurring: 1000, discount });
    expect(elementsOptionsOf(discounted, { paymentMethodTypes: ["card"] })).toMatchObject({
      mode: "subscription",
      amount: 1000,
      paymentMethodTypes: ["card"],
    });
  });

  it("works out the intent from what's due now when the backend names none", () => {
    const base = { currency: "usd", interval: "month" as const, intervalCount: 1 };
    expect(
      intentTypeOf(
        quote({
          intentType: undefined,
          subscriptionDetails: { ...base, amount: 0, amountDueNow: 0 },
        }),
      ),
    ).toBe("SetupIntent");
    expect(
      intentTypeOf(quote({ intentType: undefined, subscriptionDetails: { ...base, amount: 500 } })),
    ).toBe("PaymentIntent");
  });
});

describe("<ExpressCheckoutElement>", () => {
  const express = () => stripe.express as NonNullable<typeof stripe.express>;

  it("passes Stripe's own options through", async () => {
    await mount({ children: <ExpressCheckoutElement options={{ buttonHeight: 48 }} /> });
    expect(express().options).toEqual({ buttonHeight: 48 });
  });

  it("completes a wallet payment without the CTA, reporting it like any purchase", async () => {
    answerConfirm({ subscriptionId: "sub_1" });
    const onComplete = vi.fn();
    const { names } = await mount({ props: { onComplete }, children: <ExpressCheckoutElement /> });
    const click = { resolve: vi.fn(), reject: vi.fn() };
    const confirmed = { paymentFailed: vi.fn() };
    await act(async () => {
      express().onClick(click);
      await express().onConfirm(confirmed);
    });
    await settle();
    expect(click.resolve).toHaveBeenCalledOnce();
    expect(confirmed.paymentFailed).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ reference: "primary" }));
    expect(names()).toEqual([
      "stripe_checkout_start",
      "stripe_checkout_submit",
      "stripe_checkout_complete",
    ]);
  });

  it("sends no email when the wallet gives none", async () => {
    answerConfirm({ subscriptionId: "sub_1" });
    stripe.client.createPaymentMethod.mockResolvedValue({
      paymentMethod: { id: "pm_wallet", billing_details: {} },
    });
    await mount({ children: <ExpressCheckoutElement /> });
    await act(async () => {
      express().onClick({ resolve: vi.fn(), reject: vi.fn() });
      await express().onConfirm({ paymentFailed: vi.fn() });
    });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ paymentMethodId: "pm_wallet" });
    expect(body.email).toBeUndefined();
  });

  it("reports an abandon when the shopper closes the wallet", async () => {
    const onAbandon = vi.fn();
    const { names, checkout } = await mount({
      props: { onAbandon },
      children: <ExpressCheckoutElement />,
    });
    await act(async () => {
      express().onClick({ resolve: vi.fn(), reject: vi.fn() });
    });
    expect(checkout()).toMatchObject({ status: "paying", canSubmit: false });
    await act(async () => {
      express().onCancel();
    });
    await settle();
    expect(onAbandon).toHaveBeenCalledWith(expect.objectContaining({ reference: "primary" }));
    expect(names()).toEqual(["stripe_checkout_start", "stripe_checkout_abandon"]);
    expect(checkout()).toMatchObject({ status: "ready", canSubmit: true });
  });

  it("tells the wallet the payment failed when Stripe refuses the wallet's details", async () => {
    stripe.form.submit.mockResolvedValue({
      error: { type: "validation_error", code: "incomplete_number", message: "Incomplete." },
    });
    const onFailure = vi.fn();
    await mount({ props: { onFailure }, children: <ExpressCheckoutElement /> });
    const confirmed = { paymentFailed: vi.fn() };
    await act(async () => {
      express().onClick({ resolve: vi.fn(), reject: vi.fn() });
      await express().onConfirm(confirmed);
    });
    expect(confirmed.paymentFailed).toHaveBeenCalledWith({ reason: "fail" });
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "incorrect_card_details" }),
    );
  });

  it("tells the wallet the payment failed when the backend declines it", async () => {
    answerConfirm({ detail: "Your card was declined.", failure: { reason: "card_declined" } }, 402);
    await mount({ children: <ExpressCheckoutElement /> });
    const confirmed = { paymentFailed: vi.fn() };
    await act(async () => {
      express().onClick({ resolve: vi.fn(), reject: vi.fn() });
      await express().onConfirm(confirmed);
    });
    expect(confirmed.paymentFailed).toHaveBeenCalledWith({ reason: "fail" });
  });

  it("refuses to open the wallet before the form can take payment", async () => {
    await mount({ prepare: null, children: <ExpressCheckoutElement /> });
    const click = { resolve: vi.fn(), reject: vi.fn() };
    act(() => express().onClick(click));
    expect(click.reject).toHaveBeenCalledOnce();
    expect(click.resolve).not.toHaveBeenCalled();
  });

  it("fails a confirm that arrives without a click", async () => {
    await mount({ children: <ExpressCheckoutElement /> });
    const confirmed = { paymentFailed: vi.fn() };
    await act(async () => {
      await express().onConfirm(confirmed);
    });
    expect(confirmed.paymentFailed).toHaveBeenCalledWith({ reason: "fail" });
  });

  it("ignores a cancel that arrives without a click", async () => {
    const onAbandon = vi.fn();
    await mount({ props: { onAbandon }, children: <ExpressCheckoutElement /> });
    act(() => express().onCancel());
    expect(onAbandon).not.toHaveBeenCalled();
  });
});

describe("<PurchaseButton>", () => {
  it("is disabled until the form can take payment", async () => {
    await mount({ prepare: null, children: <PurchaseButton>Subscribe</PurchaseButton> });
    const button = screen.getByRole("button", { name: "Subscribe" });
    expect(button).toHaveProperty("disabled", true);
    expect(button.dataset.status).toBe("preparing");
    expect(button.getAttribute("type")).toBe("button");
  });

  it("pays on click, busy while paying", async () => {
    answerConfirm({ subscriptionId: "sub_1" });
    const { promise, release } = held();
    stripe.form.submit.mockReturnValue(promise);
    const onComplete = vi.fn();
    await mount({
      props: { onComplete },
      children: <PurchaseButton className="cta">Subscribe</PurchaseButton>,
    });
    const button = screen.getByRole("button", { name: "Subscribe" });
    expect(button.className).toBe("cta");
    expect(button).toHaveProperty("disabled", false);
    expect(button.dataset.status).toBe("ready");
    await act(async () => {
      fireEvent.click(button);
    });
    await act(async () => {
      release();
    });
    await settle();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("shows paying while a wallet is open", async () => {
    await mount({
      children: (
        <>
          <ExpressCheckoutElement />
          <PurchaseButton>Subscribe</PurchaseButton>
        </>
      ),
    });
    await act(async () => {
      stripe.express?.onClick({ resolve: vi.fn(), reject: vi.fn() });
    });
    const button = screen.getByRole("button", { name: "Subscribe" });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.dataset.status).toBe("paying");
  });

  it("lets onClick stop the payment, and stays disabled when told to", async () => {
    const onStart = vi.fn();
    await mount({
      props: { onStart },
      children: (
        <>
          <PurchaseButton onClick={(event) => event.preventDefault()}>Stopped</PurchaseButton>
          <PurchaseButton disabled>Off</PurchaseButton>
        </>
      ),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stopped" }));
    });
    expect(onStart).not.toHaveBeenCalled();
    expect(stripe.form.submit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Off" })).toHaveProperty("disabled", true);
  });
});
