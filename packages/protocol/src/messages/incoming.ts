import { z } from "zod";
import { CSSPropertyEnum } from "../pageStyles";
import { SubSchema } from "../sub";
import { PermissionTypeSchema } from "./outgoing";

/**
 * Tells the paywall to update the variables passed into liquid
 */
const IncomingMessageTemplateVariablesSchema = z.object({
  event_name: z.literal("template_variables"),
  variables: z.object({}).passthrough(),
});

export type TIncomingMessageTemplateVariables = z.infer<
  typeof IncomingMessageTemplateVariablesSchema
>;

/**
 * Tells the paywall update the substitutions
 */
const IncomingMessageTemplateSubstitutionsSchema = z.object({
  event_name: z.literal("template_substitutions"),
  substitutions: z.array(SubSchema),
});

export type TIncomingMessageTemplateSubstitutions = z.infer<
  typeof IncomingMessageTemplateSubstitutionsSchema
>;

/**
 * Tells the paywall that a substitution input is focused
 */
const IncomingMessageIsSubstitutionFocused = z.object({
  event_name: z.literal("substitution_editor_focused"),
});

export type TIncomingMessageIsSubstitutionFocused = z.infer<
  typeof IncomingMessageIsSubstitutionFocused
>;

/**
 * Tells the paywall that a substitution input is blurred
 */
const IncomingMessageIsSubstitutionBlurred = z.object({
  event_name: z.literal("substitution_editor_blurred"),
});

export type TIncomingMessageIsSubstitutionBlurred = z.infer<
  typeof IncomingMessageIsSubstitutionBlurred
>;

/**
 * Tells the paywall to start using a different set of substitutions
 */
const IncomingMessageSubstitutionsPrefixSchema = z.object({
  event_name: z.literal("template_substitutions_prefix"),
  prefix: z.union([z.string(), z.null()]),
});

export type TIncomingMessageSubstitutionsPrefix = z.infer<
  typeof IncomingMessageSubstitutionsPrefixSchema
>;

export const ProductIdentifierAndTypeSchema = z.object({
  product: z.string(),
  productId: z.string(),
});

export type ProductIdentifierAndType = z.infer<typeof ProductIdentifierAndTypeSchema>;

const IncomingMessageProductsSchema = z.object({
  event_name: z.literal("products"),
  products: z.array(ProductIdentifierAndTypeSchema),
});

export type TIncomingMessageProducts = z.infer<typeof IncomingMessageProductsSchema>;

// The paywall has received the experiment event
const IncomingMessageExperimentSchema = z.object({
  event_name: z.literal("experiment"),
  experimentId: z.string(),
  variantId: z.string(),
  campaignId: z.string(),
});

export type TIncomingMessageExperiment = z.infer<typeof IncomingMessageExperimentSchema>;

// Application settings
const IncomingMessageApplicationSettingsSchema = z.object({
  event_name: z.literal("application_settings"),
  settings: z.array(z.any()),
});

export type TIncomingMessageApplicationSettings = z.infer<
  typeof IncomingMessageApplicationSettingsSchema
>;

// Paywall settings
const IncomingMessagePaywallSettingsSchema = z.object({
  event_name: z.literal("paywall_settings"),
  settings: z.array(z.any()),
});

export type TIncomingMessagePaywallSettings = z.infer<typeof IncomingMessagePaywallSettingsSchema>;

/**
 * Tells the paywall we received a game controller input
 */
const IncomingMessageGameControllerInputDirectionalSchema = z.object({
  event_name: z.literal("game_controller_input"),
  controller_element: z.string(),
  directional: z.literal(true),
  x: z.number(),
  y: z.number(),
});

export type TIncomingMessageGameControllerInputDirectional = z.infer<
  typeof IncomingMessageGameControllerInputDirectionalSchema
>;

/**
 * Tells the paywall we received a game controller input
 */
const IncomingMessageGameControllerInputNonDirectionalSchema = z.object({
  event_name: z.literal("game_controller_input"),
  controller_element: z.string(),
  directional: z.literal(false),
  value: z.number(),
});

export type TIncomingMessageGameControllerInputNonDirectional = z.infer<
  typeof IncomingMessageGameControllerInputNonDirectionalSchema
>;

const IncomingMessageGameControllerInputSchema = z.union([
  IncomingMessageGameControllerInputDirectionalSchema,
  IncomingMessageGameControllerInputNonDirectionalSchema,
]);

export type TIncomingMessageGameControllerInput = z.infer<
  typeof IncomingMessageGameControllerInputSchema
>;

const IncomingMessageBackButtonInputSchema = z.object({
  event_name: z.literal("back_button_input"),
  pressed: z.boolean(),
});

export type TIncomingMessageBackButtonInput = z.infer<typeof IncomingMessageBackButtonInputSchema>;

const IncomingMessageFocusSubstitutionSchema = z.object({
  event_name: z.literal("focus_substitution"),
  key: z.string(),
});

export type TIncomingMessageFocusSubstitution = z.infer<
  typeof IncomingMessageFocusSubstitutionSchema
>;

const IncomingMessageUnFocusSubstitutionSchema = z.object({
  event_name: z.literal("unfocus_substitution"),
});

export type TIncomingMessageUnFocusSubstitution = z.infer<
  typeof IncomingMessageUnFocusSubstitutionSchema
>;

const IncomingMessageFocusHoveredSubstitutionSchema = z.object({
  event_name: z.literal("focus_hovered_substitution"),
  key: z.string(),
});

export type TIncomingMessageFocusHoveredSubstitution = z.infer<
  typeof IncomingMessageFocusHoveredSubstitutionSchema
>;

const IncomingMessageUnFocusHoveredSubstitutionSchema = z.object({
  event_name: z.literal("unfocus_hovered_substitution"),
});

export type TIncomingMessageUnFocusHoveredSubstitution = z.infer<
  typeof IncomingMessageUnFocusHoveredSubstitutionSchema
>;

const IncomingMessagePageStyles = z.object({
  event_name: z.literal("page_styles"),
  pageStyles: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      property: CSSPropertyEnum,
    }),
  ),
});

export type TIncomingMessagePageStyles = z.infer<typeof IncomingMessagePageStyles>;

const IncomingMessageTemplateJSON = z.object({
  event_name: z.literal("template_json"),
  json: z.object({}).passthrough(),
  reset: z.boolean().optional(),
});

export type TIncomingMessageTemplateJSON = z.infer<typeof IncomingMessageTemplateJSON>;

const IncomingMessagePaywallOpen = z.object({
  event_name: z.literal("paywall_open"),
  paywall_id: z.string(),
  paywall_identifier: z.string(),
});

export type TIncomingMessagePaywallOpen = z.infer<typeof IncomingMessagePaywallOpen>;

/**
 * Tells the paywall that a free trial has started
 * Used to trigger local notification scheduling
 */
const IncomingMessageFreeTrialStart = z.object({
  event_name: z.literal("freeTrial_start"),
  product_identifier: z.string().optional(),
  trial_end_date: z.string().optional(),
});

export type TIncomingMessageFreeTrialStart = z.infer<typeof IncomingMessageFreeTrialStart>;

/**
 * Tells the paywall that a transaction has completed
 * Used to trigger post-purchase actions and set transaction state variables
 */
const IncomingMessageTransactionComplete = z.object({
  event_name: z.literal("transaction_complete"),
  product_identifier: z.string().optional(),
  product: z.string().optional(), // Reference name (e.g., "primary", "secondary")
});

export type TIncomingMessageTransactionComplete = z.infer<
  typeof IncomingMessageTransactionComplete
>;

/**
 * Tells the paywall that a transaction was abandoned
 * Used to set transaction state variables for showing abandonment modals/offers
 */
const IncomingMessageTransactionAbandon = z.object({
  event_name: z.literal("transaction_abandon"),
  product_identifier: z.string().optional(),
  product: z.string().optional(), // Reference name (e.g., "primary", "secondary")
});

export type TIncomingMessageTransactionAbandon = z.infer<typeof IncomingMessageTransactionAbandon>;
/**
 * Permission status values matching OS-level permission states
 */
export const PermissionStatusSchema = z.enum([
  "granted", // User granted permission
  "denied", // User denied permission
  "unsupported", // Platform doesn't support this permission
]);

export type TPermissionStatus = z.infer<typeof PermissionStatusSchema>;

/**
 * Tells the paywall the result of a permission request
 */
const IncomingMessagePermissionResult = z.object({
  event_name: z.literal("permission_result"),
  permission_type: PermissionTypeSchema,
  request_id: z.string(),
  status: PermissionStatusSchema,
});

export type TIncomingMessagePermissionResult = z.infer<typeof IncomingMessagePermissionResult>;

/**
 * Tells the paywall the result of a custom callback
 * Correlates with the outgoing request_callback message via request_id
 */
const IncomingMessageCallbackResult = z.object({
  event_name: z.literal("callback_result"),
  request_id: z.string(), // Correlates with outgoing request_callback - {camelCaseName}-{behavior}-{uuid}
  name: z.string(), // The callback name identifier the user provided, non sanitized
  status: z.enum(["success", "failure"]), // The result status
  data: z.record(z.string(), z.any()).optional(), // Optional data returned from the SDK
});

export type TIncomingMessageCallbackResult = z.infer<typeof IncomingMessageCallbackResult>;

export const IncomingMessageSchema = z.union([
  IncomingMessageTemplateVariablesSchema,
  IncomingMessageTemplateSubstitutionsSchema,
  IncomingMessageSubstitutionsPrefixSchema,
  IncomingMessageProductsSchema,
  IncomingMessageExperimentSchema,
  IncomingMessagePaywallSettingsSchema,
  IncomingMessageApplicationSettingsSchema,
  IncomingMessageGameControllerInputSchema,
  IncomingMessageBackButtonInputSchema,
  IncomingMessageFocusSubstitutionSchema,
  IncomingMessageUnFocusSubstitutionSchema,
  IncomingMessageFocusHoveredSubstitutionSchema,
  IncomingMessageUnFocusHoveredSubstitutionSchema,
  IncomingMessageIsSubstitutionFocused,
  IncomingMessageIsSubstitutionBlurred,
  IncomingMessagePageStyles,
  IncomingMessageTemplateJSON,
  IncomingMessagePaywallOpen,
  IncomingMessageFreeTrialStart,
  IncomingMessageTransactionComplete,
  IncomingMessageTransactionAbandon,
  IncomingMessagePermissionResult,
  IncomingMessageCallbackResult,
]);

export type TIncomingMessage = z.infer<typeof IncomingMessageSchema>;
