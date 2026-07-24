export { defineConfig, mergeSurfaceConfig, type SuperwallAppConfig } from "./app";
export { mergeMessages } from "./messages";
export { definePaywall, type PaywallDefinition } from "./paywall";
export {
  resolveVariables,
  v,
  type InferVariables,
  type VariableSpec,
  type VariablesSchema,
} from "./variables";
