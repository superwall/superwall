import type {
  TIncomingMessage,
  TIncomingMessageExperiment,
  TIncomingMessagePaywallClose,
  TIncomingMessagePaywallOpen,
  TIncomingMessageProducts,
  TIncomingMessageSubstitutionsPrefix,
  TIncomingMessageTemplateVariables,
} from "@superwall/protocol";
import { hasIntroductoryOffer, type HostState } from "../state";

export const templateVariables = (state: HostState): TIncomingMessageTemplateVariables => ({
  event_name: "template_variables",
  variables: {
    device: state.device,
    user: state.user,
    params: state.params,
    ...(state.products.length > 0
      ? { products: state.products.map((product) => ({ [product.reference]: product.variables })) }
      : {}),
  },
});

export const experiment = (state: HostState): TIncomingMessageExperiment => ({
  event_name: "experiment",
  experimentId: state.experiment.experimentId,
  variantId: state.experiment.variantId,
  campaignId: state.experiment.campaignId,
});

export const products = (state: HostState): TIncomingMessageProducts => ({
  event_name: "products",
  products: state.products.map((product) => ({
    product: product.reference,
    productId: product.productId,
  })),
});

export const substitutionsPrefix = (state: HostState): TIncomingMessageSubstitutionsPrefix => ({
  event_name: "template_substitutions_prefix",
  prefix: hasIntroductoryOffer(state) ? "freeTrial" : "default",
});

export const paywallOpen = (state: HostState): TIncomingMessagePaywallOpen => ({
  event_name: "paywall_open",
  paywall_id: state.paywallId,
  paywall_identifier: state.paywallIdentifier,
});

export const paywallClose = (state: HostState): TIncomingMessagePaywallClose => ({
  event_name: "paywall_close",
  paywall_id: state.paywallId,
  paywall_identifier: state.paywallIdentifier,
});

export const pingReply = (state: HostState): TIncomingMessage[] => [
  templateVariables(state),
  experiment(state),
  products(state),
  substitutionsPrefix(state),
  paywallOpen(state),
];
