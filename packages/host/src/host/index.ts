import type { TIncomingMessage, TOutgoingMessage } from "@superwall/protocol";
import type { HostDelegate } from "../delegate";
import {
  experiment,
  paywallClose,
  pingReply,
  products,
  substitutionsPrefix,
  templateVariables,
} from "../messages";
import {
  createHostState,
  hasIntroductoryOffer,
  mergeHostState,
  type HostState,
  type HostStatePatch,
} from "../state";
import { callback, permission, purchase, restore, type FlowContext, type HostSend } from "./flows";

export type { HostSend } from "./flows";

export type PaywallHostOptions = {
  state?: HostStatePatch;
  delegate: HostDelegate;
  send: HostSend;
  now?: () => number;
};

export type PaywallHost = {
  readonly state: HostState;
  receive(events: readonly TOutgoingMessage[]): void;
  update(patch: HostStatePatch): void;
  send: HostSend;
};

const variablesOf = (state: HostState) =>
  JSON.stringify([
    state.device,
    state.user,
    state.params,
    state.products.map((product) => [product.reference, product.variables]),
  ]);

const productIdsOf = (state: HostState) =>
  JSON.stringify(state.products.map((product) => [product.reference, product.productId]));

const experimentOf = (state: HostState) => JSON.stringify(state.experiment);

export const createPaywallHost = (options: PaywallHostOptions): PaywallHost => {
  let state = createHostState(options.state);
  const { delegate, send } = options;
  const context: FlowContext = {
    state: () => state,
    delegate,
    send,
    now: options.now ?? Date.now,
  };

  const handle = (message: TOutgoingMessage) => {
    switch (message.event_name) {
      case "ping":
        send(pingReply(state));
        return;
      case "purchase":
        purchase(context, message);
        return;
      case "restore":
        restore(context);
        return;
      case "close":
        delegate.close();
        send([paywallClose(state)]);
        return;
      case "open_url":
        delegate.openUrl(
          message.url,
          message.browser_type === "payment_sheet" ? "payment_sheet" : "in_app",
        );
        return;
      case "open_url_external":
        delegate.openUrl(message.url, "external");
        return;
      case "open_deep_link":
        delegate.openUrl(message.link, "deep_link");
        return;
      case "custom":
        delegate.custom(message.data);
        return;
      case "custom_placement":
        delegate.customPlacement(message.name, message.params);
        return;
      case "user_attribute_updated":
        state = mergeHostState(state, {
          user: Object.fromEntries(message.attributes.map((entry) => [entry.key, entry.value])),
        });
        return;
      case "request_permission":
        permission(context, message);
        return;
      case "request_callback":
        callback(context, message);
        return;
      default:
        return;
    }
  };

  const receive: PaywallHost["receive"] = (events) => {
    for (const message of events) {
      delegate.event(message);
      handle(message);
    }
  };

  const update: PaywallHost["update"] = (patch) => {
    const previous = state;
    state = mergeHostState(state, patch);
    const replies: TIncomingMessage[] = [];
    if (variablesOf(previous) !== variablesOf(state)) replies.push(templateVariables(state));
    if (experimentOf(previous) !== experimentOf(state)) replies.push(experiment(state));
    if (productIdsOf(previous) !== productIdsOf(state)) replies.push(products(state));
    if (hasIntroductoryOffer(previous) !== hasIntroductoryOffer(state)) {
      replies.push(substitutionsPrefix(state));
    }
    if (replies.length > 0) send(replies);
  };

  return {
    get state() {
      return state;
    },
    receive,
    update,
    send,
  };
};
