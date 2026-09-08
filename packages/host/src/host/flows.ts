import type { TIncomingMessage, TOutgoingMessage } from "@superwall/protocol";
import type { Answer, HostDelegate } from "../delegate";
import {
  callbackResult,
  freeTrialStart,
  permissionResult,
  restoreComplete,
  restoreFail,
  restoreStart,
  transactionAbandon,
  transactionComplete,
  transactionFail,
  transactionRestore,
  transactionStart,
} from "../messages";
import { hasIntroductoryOffer, trialPeriodDays, type HostProduct, type HostState } from "../state";

export type HostSend = (events: readonly TIncomingMessage[]) => void;

export type FlowContext = {
  state: () => HostState;
  delegate: HostDelegate;
  send: HostSend;
  now: () => number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const settle = <T>(
  ask: () => Answer<T>,
  onValue: (value: T) => void,
  onError: (error: unknown) => void,
): void => {
  new Promise<T>((resolve) => resolve(ask())).then(onValue, onError);
};

const fail = (context: string, error: unknown) => {
  console.error(`[superwall host] ${context}`, error);
};

export const findProduct = (state: HostState, reference: string, productId?: string): HostProduct =>
  state.products.find((product) => product.reference === reference) ??
  state.products.find((product) => product.productId === productId) ?? {
    reference,
    productId: productId ?? reference,
    variables: {},
  };

export const purchase = (
  context: FlowContext,
  message: Extract<TOutgoingMessage, { event_name: "purchase" }>,
): void => {
  const { delegate, send, now } = context;
  const product = findProduct(context.state(), message.product, message.product_identifier);
  send([transactionStart(product)]);
  settle(
    () => delegate.purchase(product),
    (outcome) => {
      if (outcome === "completed") {
        const days = trialPeriodDays(product);
        const replies: TIncomingMessage[] = [transactionComplete(product)];
        if (hasIntroductoryOffer(context.state()) && days > 0) {
          replies.push(freeTrialStart(product, now() + days * DAY_MS));
        }
        send(replies);
      } else if (outcome === "abandoned") {
        send([transactionAbandon(product)]);
      } else {
        send([transactionFail(product)]);
      }
    },
    (error) => {
      fail("purchase delegate threw", error);
      send([transactionFail(product)]);
    },
  );
};

export const restore = (context: FlowContext): void => {
  const { delegate, send } = context;
  send([restoreStart()]);
  settle(
    () => delegate.restore(),
    (outcome) => {
      send(outcome === "restored" ? [transactionRestore(), restoreComplete()] : [restoreFail()]);
    },
    (error) => {
      fail("restore delegate threw", error);
      send([restoreFail()]);
    },
  );
};

export const permission = (
  context: FlowContext,
  message: Extract<TOutgoingMessage, { event_name: "request_permission" }>,
): void => {
  const { delegate, send } = context;
  const reply = (status: "granted" | "denied" | "unsupported") =>
    send([
      permissionResult({
        permissionType: message.permission_type,
        requestId: message.request_id,
        status,
      }),
    ]);
  settle(
    () => delegate.permission(message.permission_type),
    reply,
    (error) => {
      fail("permission delegate threw", error);
      reply("denied");
    },
  );
};

export const callback = (
  context: FlowContext,
  message: Extract<TOutgoingMessage, { event_name: "request_callback" }>,
): void => {
  const { delegate, send } = context;
  const reply = (result: { status: "success" | "failure"; data?: Record<string, unknown> }) =>
    send([
      callbackResult({
        requestId: message.request_id,
        name: message.name,
        status: result.status,
        ...(result.data === undefined ? {} : { data: result.data }),
      }),
    ]);
  settle(
    () => delegate.callback(message.name, message.variables ?? {}),
    reply,
    (error) => {
      fail("callback delegate threw", error);
      reply({ status: "failure" });
    },
  );
};
