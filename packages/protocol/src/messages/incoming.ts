import { z } from "zod";
import { PermissionStatusSchema, PermissionTypeSchema } from "./permissions";

const templateVariables = z.object({
  event_name: z.literal("template_variables"),
  variables: z.object({}).passthrough(),
});

const templateSubstitutions = z.object({
  event_name: z.literal("template_substitutions"),
  substitutions: z.array(z.unknown()),
});

const substitutionEditorFocused = z.object({
  event_name: z.literal("substitution_editor_focused"),
});

const substitutionEditorBlurred = z.object({
  event_name: z.literal("substitution_editor_blurred"),
});

const templateSubstitutionsPrefix = z.object({
  event_name: z.literal("template_substitutions_prefix"),
  prefix: z.union([z.string(), z.null()]),
});

const productIdentifierAndType = z.object({
  product: z.string(),
  productId: z.string(),
});

export type ProductIdentifierAndType = z.infer<typeof productIdentifierAndType>;

const products = z.object({
  event_name: z.literal("products"),
  products: z.array(productIdentifierAndType),
});

const experiment = z.object({
  event_name: z.literal("experiment"),
  experimentId: z.string(),
  variantId: z.string(),
  campaignId: z.string(),
});

const applicationSettings = z.object({
  event_name: z.literal("application_settings"),
  settings: z.array(z.any()),
});

const paywallSettings = z.object({
  event_name: z.literal("paywall_settings"),
  settings: z.array(z.any()),
});

const gameControllerInput = z.union([
  z.object({
    event_name: z.literal("game_controller_input"),
    controller_element: z.string(),
    directional: z.literal(true),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    event_name: z.literal("game_controller_input"),
    controller_element: z.string(),
    directional: z.literal(false),
    value: z.number(),
  }),
]);

const backButtonInput = z.object({
  event_name: z.literal("back_button_input"),
});

const focusSubstitution = z.object({
  event_name: z.literal("focus_substitution"),
  key: z.string(),
});

const unfocusSubstitution = z.object({
  event_name: z.literal("unfocus_substitution"),
});

const focusHoveredSubstitution = z.object({
  event_name: z.literal("focus_hovered_substitution"),
  key: z.string(),
});

const unfocusHoveredSubstitution = z.object({
  event_name: z.literal("unfocus_hovered_substitution"),
});

const pageStyles = z.object({
  event_name: z.literal("page_styles"),
  pageStyles: z.array(z.unknown()),
});

const templateJson = z.object({
  event_name: z.literal("template_json"),
  json: z.object({}).passthrough(),
  reset: z.boolean().optional(),
});

const paywallOpen = z.object({
  event_name: z.literal("paywall_open"),
  paywall_id: z.string(),
  paywall_identifier: z.string(),
  presentation_id: z.string().optional(),
  presented_by: z.string().optional(),
  presentation_source_type: z.string().optional(),
  presented_by_event_id: z.string().optional(),
  presented_by_event_name: z.string().optional(),
});

const freeTrialStart = z.object({
  event_name: z.literal("freeTrial_start"),
  product_identifier: z.string().optional(),
  trial_end_date: z.union([z.string(), z.number()]).optional(),
});

const transaction = <E extends string>(eventName: E) =>
  z.object({
    event_name: z.literal(eventName),
    product_identifier: z.string().optional(),
    product: z.string().optional(),
  });

const transactionComplete = transaction("transaction_complete");
const transactionAbandon = transaction("transaction_abandon");
const transactionStart = transaction("transaction_start");
const transactionFail = transaction("transaction_fail");
const transactionTimeout = transaction("transaction_timeout");
const transactionRestore = transaction("transaction_restore");

const permissionResult = z.object({
  event_name: z.literal("permission_result"),
  permission_type: PermissionTypeSchema,
  request_id: z.string(),
  status: PermissionStatusSchema,
});

const callbackResult = z.object({
  event_name: z.literal("callback_result"),
  request_id: z.string(),
  name: z.string(),
  status: z.enum(["success", "failure"]),
  data: z.record(z.string(), z.any()).optional(),
});

const restoreStart = z.object({ event_name: z.literal("restore_start") });
const restoreComplete = z.object({ event_name: z.literal("restore_complete") });
const restoreFail = z.object({ event_name: z.literal("restore_fail") });

const paywallClose = z.object({
  event_name: z.literal("paywall_close"),
  paywall_id: z.string().optional(),
  paywall_identifier: z.string().optional(),
});

const eventTrackingBehaviorValue = z.enum(["all", "superwallOnly", "none"]);

export type TEventTrackingBehavior = z.infer<typeof eventTrackingBehaviorValue>;

const eventTrackingBehavior = z.object({
  event_name: z.literal("event_tracking_behavior"),
  behavior: eventTrackingBehaviorValue,
});

const redeemDiscount = z.object({
  event_name: z.literal("redeem_discount"),
  code: z.string(),
});

export const IncomingMessageSchema = z.union([
  templateVariables,
  templateSubstitutions,
  templateSubstitutionsPrefix,
  products,
  experiment,
  paywallSettings,
  applicationSettings,
  gameControllerInput,
  backButtonInput,
  focusSubstitution,
  unfocusSubstitution,
  focusHoveredSubstitution,
  unfocusHoveredSubstitution,
  substitutionEditorFocused,
  substitutionEditorBlurred,
  pageStyles,
  templateJson,
  paywallOpen,
  freeTrialStart,
  transactionComplete,
  transactionAbandon,
  permissionResult,
  callbackResult,
  transactionStart,
  transactionFail,
  transactionTimeout,
  transactionRestore,
  restoreStart,
  restoreComplete,
  restoreFail,
  paywallClose,
  eventTrackingBehavior,
  redeemDiscount,
]);

export type TIncomingMessage = z.infer<typeof IncomingMessageSchema>;

export type TIncomingMessageTemplateVariables = z.infer<typeof templateVariables>;
export type TIncomingMessageTemplateSubstitutions = z.infer<typeof templateSubstitutions>;
export type TIncomingMessageSubstitutionsPrefix = z.infer<typeof templateSubstitutionsPrefix>;
export type TIncomingMessageProducts = z.infer<typeof products>;
export type TIncomingMessageExperiment = z.infer<typeof experiment>;
export type TIncomingMessageGameControllerInput = z.infer<typeof gameControllerInput>;
export type TIncomingMessageBackButtonInput = z.infer<typeof backButtonInput>;
export type TIncomingMessagePageStyles = z.infer<typeof pageStyles>;
export type TIncomingMessageTemplateJSON = z.infer<typeof templateJson>;
export type TIncomingMessagePaywallOpen = z.infer<typeof paywallOpen>;
export type TIncomingMessageFreeTrialStart = z.infer<typeof freeTrialStart>;
export type TIncomingMessageTransactionComplete = z.infer<typeof transactionComplete>;
export type TIncomingMessageTransactionAbandon = z.infer<typeof transactionAbandon>;
export type TIncomingMessageTransactionStart = z.infer<typeof transactionStart>;
export type TIncomingMessageTransactionFail = z.infer<typeof transactionFail>;
export type TIncomingMessageTransactionTimeout = z.infer<typeof transactionTimeout>;
export type TIncomingMessageTransactionRestore = z.infer<typeof transactionRestore>;
export type TIncomingMessagePermissionResult = z.infer<typeof permissionResult>;
export type TIncomingMessageCallbackResult = z.infer<typeof callbackResult>;
export type TIncomingMessageRestoreStart = z.infer<typeof restoreStart>;
export type TIncomingMessageRestoreComplete = z.infer<typeof restoreComplete>;
export type TIncomingMessageRestoreFail = z.infer<typeof restoreFail>;
export type TIncomingMessagePaywallClose = z.infer<typeof paywallClose>;
export type TIncomingMessageEventTrackingBehavior = z.infer<typeof eventTrackingBehavior>;
export type TIncomingMessageRedeemDiscount = z.infer<typeof redeemDiscount>;
