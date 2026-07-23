import { Integration } from "@/constants";
import type { DetectedApp } from "@/core/project/scan";
import type { ExistingIntegration } from "@/core/project/existing";
import type { AgentCapabilities } from "./drivers";
import { loadBundledSkill } from "./skills";

/** Skill reference file per framework, so an agent only sees its own platform's docs. */
export const FRAMEWORK_REF: Partial<Record<Integration, string>> = {
  [Integration.swift]: "ios",
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
  /** Per-app public key (pk_) for SDK init. May be "" for read-only actions. */
  apiKey: string;
  existing: ExistingIntegration;
  priorReport?: string;
  campaigns?: string;
  billingProvider?: string;
  /** "full" (replace provider) or "paywalls" (keep provider for billing). */
  migrateIntent?: string;
}

/** One agent-driven task. Metadata lives here; the prompt body lives in prompts/actions/<id>.xml. */
export interface WizardAction {
  id: ActionId;
  title: string;
  hint: string;
  runningLabel: string;
  successLabel: string;
  /** Only offer when the app already has the SDK installed. */
  requiresIntegration: boolean;
  /** Needs the org-scoped session (REST API) - gated on auth. */
  requiresOrgKey: boolean;
  /** "silent" = no final output; "report" = render the agent's final findings. */
  outputMode: "silent" | "report";
  capabilities: AgentCapabilities;
  /** Variables for the action's prompt template. */
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

export const ACTIONS: WizardAction[] = [
  {
    id: "integrate",
    title: "Integrate the SDK",
    hint: "Install + configure the Superwall SDK",
    runningLabel: "Starting the integration",
    successLabel: "Integration complete",
    requiresIntegration: false,
    requiresOrgKey: false,
    outputMode: "silent",
    capabilities: WRITE_CAPABILITIES,
    vars: (ctx) => ({
      skill: loadBundledSkill("superwall-integrate", FRAMEWORK_REF[ctx.app.framework.integration]),
    }),
  },
  {
    id: "review",
    title: "Review the setup",
    hint: "Audit the SDK, purchasing, identity, deep links, placements & dashboard",
    runningLabel: "Reviewing your Superwall setup",
    successLabel: "Setup review complete",
    requiresIntegration: true,
    requiresOrgKey: false,
    outputMode: "report",
    capabilities: READ_CAPABILITIES,
    vars: (ctx) => ({
      skill: loadBundledSkill("superwall-review", FRAMEWORK_REF[ctx.app.framework.integration]),
    }),
  },
  {
    id: "review-fix",
    title: "Fix setup issues",
    hint: "Apply verified, safe fixes from the setup review",
    runningLabel: "Fixing your Superwall setup",
    successLabel: "Setup fixes complete",
    requiresIntegration: true,
    requiresOrgKey: false,
    outputMode: "silent",
    capabilities: WRITE_CAPABILITIES,
    vars: (ctx) => ({
      prior_report: ctx.priorReport ?? "",
      skill: loadBundledSkill("superwall-review", FRAMEWORK_REF[ctx.app.framework.integration]),
    }),
  },
  {
    id: "placements-review",
    title: "Review placements",
    hint: "Audit every register() call + positioning",
    runningLabel: "Reviewing placements",
    successLabel: "Placement review complete",
    requiresIntegration: true,
    requiresOrgKey: false,
    outputMode: "report",
    capabilities: READ_CAPABILITIES,
    vars: (ctx) => ({
      campaigns: ctx.campaigns ?? "",
      skill: loadBundledSkill("superwall-placements", [
        "strategy",
        FRAMEWORK_REF[ctx.app.framework.integration],
      ]),
    }),
  },
  {
    id: "placements-implement",
    title: "Implement placements",
    hint: "Add register() calls at the right feature gates",
    runningLabel: "Implementing placements",
    successLabel: "Placements implemented",
    requiresIntegration: true,
    requiresOrgKey: false,
    outputMode: "silent",
    capabilities: WRITE_CAPABILITIES,
    vars: (ctx) => ({
      prior_report: ctx.priorReport ?? "",
      campaigns: ctx.campaigns ?? "",
      skill: loadBundledSkill("superwall-placements", [
        "strategy",
        FRAMEWORK_REF[ctx.app.framework.integration],
      ]),
    }),
  },
  {
    id: "dashboard-setup",
    title: "Set up the dashboard",
    hint: "Create a campaign + placement so paywalls present",
    runningLabel: "Setting up the dashboard",
    successLabel: "Dashboard configured",
    requiresIntegration: false,
    requiresOrgKey: true,
    outputMode: "report",
    capabilities: { filesystem: "read", network: true, shell: "unrestricted" },
    vars: (ctx) => ({
      skill: loadBundledSkill("superwall-dashboard"),
      app_key: ctx.apiKey || "(the app you're working on)",
    }),
  },
  {
    id: "migrate",
    title: "Migrate to Superwall",
    hint: "Move products, entitlements & paywalls off your current provider",
    runningLabel: "Migrating to Superwall",
    successLabel: "Migration complete",
    requiresIntegration: false,
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
        skill: loadBundledSkill("superwall-migrate", PROVIDER_REF[provider.toLowerCase()]),
      };
    },
  },
];

export const actionById = Object.fromEntries(ACTIONS.map((a) => [a.id, a])) as Record<
  ActionId,
  WizardAction
>;
