import { WorkspaceError } from "./project";

export type ContextField =
  | "organizationId"
  | "applicationId"
  | "environment"
  | "dateRange"
  | "campaignId"
  | "audienceId"
  | "variantIds"
  | "appUserId"
  | "aliases";

export interface Slot {
  shape: "page" | "card" | "tab" | "panel" | "modal" | "headless";
  minHeight: number;
  maxHeight: number | null;
  fields: readonly ContextField[];
  optional?: readonly ContextField[];
}

const APP = ["organizationId", "applicationId"] as const;
const USER = [...APP, "appUserId", "aliases", "environment"] as const;

export const SLOTS: Readonly<Record<string, Slot>> = {
  "org.page@1": { shape: "page", minHeight: 0, maxHeight: null, fields: ["organizationId"] },
  "app.page@1": { shape: "page", minHeight: 0, maxHeight: null, fields: [...APP, "environment"] },
  "app.dashboard.widget@1": {
    shape: "card",
    minHeight: 120,
    maxHeight: 480,
    fields: [...APP, "environment", "dateRange"],
  },
  "campaign.tab@1": {
    shape: "tab",
    minHeight: 240,
    maxHeight: 4000,
    fields: [...APP, "campaignId", "audienceId", "variantIds", "environment", "dateRange"],
    optional: ["audienceId", "variantIds"],
  },
  "user.panel@1": { shape: "panel", minHeight: 80, maxHeight: 640, fields: USER, optional: ["aliases"] },
  "user.action@1": { shape: "modal", minHeight: 120, maxHeight: 640, fields: USER, optional: ["aliases"] },
  "chart.source@1": { shape: "headless", minHeight: 0, maxHeight: 0, fields: APP },
  "campaign.metric@1": {
    shape: "headless",
    minHeight: 0,
    maxHeight: 0,
    fields: [...APP, "campaignId", "audienceId", "variantIds", "environment"],
    optional: ["variantIds"],
  },
};

export interface ContextInput {
  organizationId?: string;
  applicationId?: string;
  environment?: string;
  from?: string;
  to?: string;
  campaignId?: string;
  audienceId?: string;
  variantIds?: readonly string[];
  appUserId?: string;
  aliases?: readonly string[];
  context?: string;
}

const DAY_MS = 86_400_000;

export function defaultRange(days: number, now = Date.now()): { from: string; to: string } {
  return { from: new Date(now - days * DAY_MS).toISOString(), to: new Date(now).toISOString() };
}

export function slotOf(slot: string): Slot {
  const found = SLOTS[slot];
  if (!found) {
    throw new WorkspaceError(
      `This CLI doesn't know the slot \`${slot}\`. Run \`superwall upgrade\`, or pass its context with --context.`,
    );
  }
  return found;
}

function positive(name: string, value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new WorkspaceError(`${name} must be a positive number.`);
  return parsed;
}

export function parseContextJson(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new WorkspaceError(`--context is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new WorkspaceError("--context must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

const FIELD_LABELS: Readonly<Record<ContextField, string>> = {
  organizationId: "an organization (--org)",
  applicationId: "an app (--app)",
  environment: "an environment (--environment)",
  dateRange: "a date range (--from and --to)",
  campaignId: "a campaign (--campaign)",
  audienceId: "an audience (--audience)",
  variantIds: "variants (--variant)",
  appUserId: "a user (--user)",
  aliases: "aliases (--alias)",
};

function fieldValue(field: ContextField, input: ContextInput): unknown {
  switch (field) {
    case "organizationId":
      return positive("The organization", input.organizationId);
    case "applicationId":
      return positive("The app", input.applicationId);
    case "campaignId":
      return positive("The campaign", input.campaignId);
    case "audienceId":
      return positive("The audience", input.audienceId);
    case "environment":
      return input.environment ?? "PRODUCTION";
    case "dateRange": {
      const fallback = defaultRange(30);
      const range = { from: input.from || fallback.from, to: input.to || fallback.to };
      if (Number.isNaN(Date.parse(range.from)) || Number.isNaN(Date.parse(range.to))) {
        throw new WorkspaceError("The date range needs ISO 8601 date-times, like 2026-10-01T00:00:00Z.");
      }
      return { from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() };
    }
    case "variantIds":
      return (input.variantIds ?? []).map((id) => positive("A variant", id));
    case "appUserId":
      return input.appUserId || undefined;
    case "aliases":
      return input.aliases ?? [];
  }
}

export function missingFields(slot: Slot, input: ContextInput): string[] {
  return slot.fields
    .filter((field) => {
      if (slot.optional?.includes(field)) return false;
      return fieldValue(field, input) === undefined;
    })
    .map((field) => FIELD_LABELS[field]);
}

export function buildContext(slotId: string, input: ContextInput): Record<string, unknown> {
  if (input.context !== undefined) {
    const known = {
      ...(input.organizationId ? { organizationId: positive("The organization", input.organizationId) } : {}),
      ...(input.applicationId ? { applicationId: positive("The app", input.applicationId) } : {}),
    };
    return { ...known, ...parseContextJson(input.context) };
  }
  const slot = slotOf(slotId);
  const missing = missingFields(slot, input);
  if (missing.length > 0) {
    throw new WorkspaceError(`${slotId} needs ${missing.join(", ")}.`);
  }
  const context: Record<string, unknown> = {};
  for (const field of slot.fields) {
    const value = fieldValue(field, input);
    context[field] = value === undefined && field === "audienceId" ? null : value;
  }
  return context;
}
