import { WebCheckoutController } from "./WebCheckoutController";
import { checkoutEvents } from "./CheckoutEvents";
import { startLoading, stopLoading } from "./loading";
import type { CheckoutMode, EmbeddedCheckoutSession, SessionData } from "../state/types";

type SnapshotSource = ConstructorParameters<typeof WebCheckoutController>[0];

const controllers = new WeakMap<object, WebCheckoutController>();

export const controllerFor = (session: { getSnapshot: () => unknown }): WebCheckoutController => {
  const existing = controllers.get(session);
  if (existing) return existing;
  const controller = new WebCheckoutController(session.getSnapshot.bind(session) as SnapshotSource);
  controllers.set(session, controller);
  return controller;
};

const CHECKOUT_READY_TIMEOUT = 20_000;

export const poolSession = (session: EmbeddedCheckoutSession) => {
  checkoutEvents.dispatch("SESSION_CREATED", session as SessionData);
};

export const prefetchSession = async (
  controller: WebCheckoutController,
  referenceName: string,
  mode: CheckoutMode,
): Promise<void> => {
  const result = await controller.prefetchCheckout({
    referenceName,
    mode,
    cacheScope: mode === "applePay" ? "apple-pay" : "default",
    silent: true,
  });
  if (result?.directive === "embedded") {
    poolSession(result);
  }
};

export const openEmbeddedCheckout = (session: EmbeddedCheckoutSession): Promise<{ status: string }> =>
  new Promise((resolve) => {
    const sessionData = session as SessionData;
    let opened = false;

    const readyTimeout = setTimeout(() => {
      if (!opened) finish({ status: "failed" });
    }, CHECKOUT_READY_TIMEOUT);

    const unsubscribers = [
      checkoutEvents.subscribe("EMBEDDED_READY", ({ clientSecret }) => {
        if (clientSecret !== sessionData.clientSecret || opened) return;
        opened = true;
        clearTimeout(readyTimeout);
        stopLoading();
        checkoutEvents.dispatch("SHEET_OPEN", { session: sessionData });
      }),
      checkoutEvents.subscribe("PAYMENT_SUCCESS", ({ session: paid }) => {
        if (paid.clientSecret !== sessionData.clientSecret) return;
        finish({ status: "completed" });
      }),
      checkoutEvents.subscribe("PAYMENT_ERROR", ({ session: errored }) => {
        if (errored.clientSecret !== sessionData.clientSecret) return;
        finish({ status: "failed" });
      }),
      checkoutEvents.subscribe("SHEET_CLOSE", () => {
        if (!opened) return;
        finish({ status: "abandoned" });
      }),
    ];

    const finish = (outcome: { status: string }) => {
      clearTimeout(readyTimeout);
      stopLoading();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      resolve(outcome);
    };

    startLoading();
    checkoutEvents.dispatch("SESSION_CREATED", sessionData);
  });
