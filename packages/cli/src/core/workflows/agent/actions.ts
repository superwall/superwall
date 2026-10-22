import type { ExistingIntegration } from "@/core/codebase/existing";
import type { DetectedApp } from "@/core/codebase/scan";
import { Integration } from "@/environment";
import type { AgentCapabilities } from "./drivers/index";
import { readBundledSkill } from "../../support/skills";

export const FRAMEWORK_REF: Partial<Record<Integration, string>> = {
  [Integration.swift]: "ios",
  [Integration.android]: "android",
  [Integration.expo]: "expo",
  [Integration.reactNative]: "react-native",
  [Integration.flutter]: "flutter",
};

const PROVIDER_REF: Record<string, string> = {
  revenuecat: "revenuecat",
  adapty: "adapty",
  qonversion: "qonversion",
};

export type ActionId =
  | "integrate"
  | "review"
  | "review-fix"
  | "placements-review"
  | "placements-implement"
  | "dashboard-setup"
  | "migrate";

export interface ActionContext {
  app: DetectedApp;
  apiKey: string;
  existing: ExistingIntegration;
  priorReport?: string;
  campaigns?: string;
  billingProvider?: string;
  migrateIntent?: string;
}

export interface WizardAction {
  id: ActionId;
  title: string;
  hint: string;
  runningLabel: string;
  successLabel: string;
  requiresOrgKey: boolean;
  outputMode: "silent" | "report";
  capabilities: AgentCapabilities;
  vars: (ctx: ActionContext) => Record<string, string>;
}

const WRITE_CAPABILITIES: AgentCapabilities = {
  filesystem: "write",
  network: true,
  shell: "unrestricted",
};
const READ_CAPABILITIES: AgentCapabilities = {
  filesystem: "read",
  network: true,
  shell: "read-only",
};

export const actionById: Record<ActionId, WizardAction> = {
  integrate: {
    id: "integrate",
    title: "Integrate the SDK",
    hint: "Install + configure the Superwall SDK",
    runningLabel: "Starting the integration",
    successLabel: "Integration complete",
    requiresOrgKey: false,
    outputMode: "silent",
    capabilities: WRITE_CAPABILITIES,
    vars: (ctx) => ({
      skill: readBundledSkill("superwall-integrate", FRAMEWORK_REF[ctx.app.framework.integration]),
    }),
  },
  review: {
    id: "review",
    title: "Review the setup",
    hint: "Audit the SDK, purchasing, identity, deep links, placements & dashboard",
    runningLabel: "Reviewing your Superwall setup",
    successLabel: "Setup review complete",
    requiresOrgKey: false,
    outputMode: "report",
    capabilities: READ_CAPABILITIES,
    vars: (ctx) => ({
      skill: readBundledSkill("superwall-review", FRAMEWORK_REF[ctx.app.framework.integration]),
    }),
  },
  "review-fix": {
    id: "review-fix",
    title: "Fix setup issues",
    hint: "Apply verified, safe fixes from the setup review",
    runningLabel: "Fixing your Superwall setup",
    successLabel: "Setup fixes complete",
    requiresOrgKey: false,
    outputMode: "silent",
    capabilities: WRITE_CAPABILITIES,
    vars: (ctx) => ({
      prior_report: ctx.priorReport ?? "",
      skill: readBundledSkill("superwall-review", FRAMEWORK_REF[ctx.app.framework.integration]),
    }),
  },
  "placements-review": {
    id: "placements-review",
    title: "Review placements",
    hint: "Audit every register() call + positioning",
    runningLabel: "Reviewing placements",
    successLabel: "Placement review complete",
    requiresOrgKey: false,
    outputMode: "report",
    capabilities: READ_CAPABILITIES,
    vars: (ctx) => ({
      campaigns: ctx.campaigns ?? "",
      skill: readBundledSkill("superwall-placements", [
        "strategy",
        FRAMEWORK_REF[ctx.app.framework.integration],
      ]),
    }),
  },
  "placements-implement": {
    id: "placements-implement",
    title: "Implement placements",
    hint: "Add register() calls at the right feature gates",
    runningLabel: "Implementing placements",
    successLabel: "Placements implemented",
    requiresOrgKey: false,
    outputMode: "silent",
    capabilities: WRITE_CAPABILITIES,
    vars: (ctx) => ({
      prior_report: ctx.priorReport ?? "",
      campaigns: ctx.campaigns ?? "",
      skill: readBundledSkill("superwall-placements", [
        "strategy",
        FRAMEWORK_REF[ctx.app.framework.integration],
      ]),
    }),
  },
  "dashboard-setup": {
    id: "dashboard-setup",
    title: "Set up the dashboard",
    hint: "Create a campaign + placement so paywalls present",
    runningLabel: "Setting up the dashboard",
    successLabel: "Dashboard configured",
    requiresOrgKey: true,
    outputMode: "report",
    capabilities: { filesystem: "read", network: true, shell: "unrestricted" },
    vars: (ctx) => ({
      skill: readBundledSkill("superwall-dashboard"),
      app_key: ctx.apiKey || "(the app you're working on)",
    }),
  },
  migrate: {
    id: "migrate",
    title: "Migrate to Superwall",
    hint: "Move products, entitlements & paywalls off your current provider",
    runningLabel: "Migrating to Superwall",
    successLabel: "Migration complete",
    requiresOrgKey: false,
    outputMode: "report",
    capabilities: WRITE_CAPABILITIES,
    vars: (ctx) => {
      const provider = ctx.billingProvider ?? "the current billing provider";
      return {
        provider,
        goal:
          ctx.migrateIntent === "paywalls"
            ? `paywalls only, keep ${provider} for billing`
            : "full migration",
        skill: readBundledSkill("superwall-migrate", PROVIDER_REF[provider.toLowerCase()]),
      };
    },
  },
};

export const ACTIONS: WizardAction[] = Object.values(actionById);
