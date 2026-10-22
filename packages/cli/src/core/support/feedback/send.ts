
import { FEEDBACK_KINDS, type FeedbackKind } from "./kinds";
import { readFileSync } from "node:fs";
import { arch, release } from "node:os";
import { basename } from "node:path";
import type { CommandContext } from "@/program/command";
import type { SuperwallApi } from "@/core/api/client";
import { findApplication } from "@/core/api/lookup";
import { orgIdOf } from "@/core/api/orgs";
import { readSession } from "@/core/account/storage";
import { readAnonymousId, readOnboardedApp } from "@/core/state/config";
import { TELEMETRY_HOST, TELEMETRY_KEY, VERSION } from "@/environment";

type FeedbackVia = "human" | "agent";

export const MAX_FILES = 5;
export const MAX_FILE_CHARS = 20_000;

interface FeedbackAttachment {
  name: string;
  content: string;
  truncated: boolean;
}

interface Feedback {
  title?: string;
  message: string;
  kind: FeedbackKind;
  command?: string;
  agent?: string;
  projectId?: string;
  applicationId?: string;
  organizationId?: string;
  context: Record<string, string>;
  attachments: FeedbackAttachment[];
}

export function parseContext(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at < 1) throw new Error(`--context expects key=value, got "${pair}"`);
    out[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  }
  return out;
}

function linkedApp(cwd = process.cwd()): {
  projectId?: string;
  applicationId?: string;
} {
  const app = readOnboardedApp(cwd);
  return { projectId: app?.projectId, applicationId: app?.applicationId };
}

const AGENT_ENV: [string, string][] = [
  ["CLAUDECODE", "claude-code"],
  ["CODEX_SANDBOX", "codex"],
  ["CURSOR_AGENT", "cursor"],
  ["GEMINI_CLI", "gemini-cli"],
];

export function detectAgent(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return AGENT_ENV.find(([key]) => env[key])?.[1];
}

export function readAttachments(paths: string[]): FeedbackAttachment[] {
  if (paths.length > MAX_FILES) {
    throw new Error(`Attach at most ${MAX_FILES} files.`);
  }
  return paths.map((path) => {
    const raw = readFileSync(path === "-" ? 0 : path, "utf8");
    const truncated = raw.length > MAX_FILE_CHARS;
    return {
      name: path === "-" ? "stdin" : basename(path),
      content: truncated ? raw.slice(-MAX_FILE_CHARS) : raw,
      truncated,
    };
  });
}

export function buildFeedbackEvent(
  feedback: Feedback,
  via: FeedbackVia,
  distinctId: string,
  session: {
    userEmail?: string;
    orgName?: string;
    authMethod?: string;
  } | null,
): Record<string, unknown> {
  return {
    api_key: TELEMETRY_KEY(),
    event: "feedback submitted",
    distinct_id: distinctId,
    timestamp: new Date().toISOString(),
    properties: {
      $process_person_profile: false,
      title: feedback.title ?? null,
      message: feedback.message,
      kind: feedback.kind,
      command: feedback.command ?? null,
      project_id: feedback.projectId ?? null,
      application_id: feedback.applicationId ?? null,
      organization_id: feedback.organizationId ?? null,
      context: feedback.context,
      attachments: feedback.attachments,
      via,
      agent: feedback.agent ?? null,
      cli_version: VERSION,
      platform: process.platform,
      os_release: release(),
      arch: arch(),
      node_version: process.version,
      ci: process.env.CI === "true",
      email: session?.userEmail ?? null,
      org_name: session?.orgName ?? null,
      auth_method: session?.authMethod ?? null,
    },
  };
}

async function submitFeedback(feedback: Feedback, via: FeedbackVia): Promise<boolean> {
  const payload = buildFeedbackEvent(feedback, via, readAnonymousId(), readSession());
  try {
    const res = await fetch(`${TELEMETRY_HOST()}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const ORG_LOOKUP_MS = 3000;

export async function organizationOfApp(
  api: SuperwallApi | undefined,
  applicationId: string | undefined,
): Promise<string | undefined> {
  if (!api || !applicationId) return undefined;
  const lookup = findApplication(api, applicationId)
    .then((found) => (found ? orgIdOf(found.project) : undefined))
    .catch(() => undefined);
  const timeout = new Promise<undefined>((resolve) => {
    setTimeout(() => resolve(undefined), ORG_LOOKUP_MS).unref();
  });
  return Promise.race([lookup, timeout]);
}

interface FeedbackInput {
  args: { message: string | undefined; };
  flags: { title: string | undefined; kind: string; command: string | undefined; app: string | undefined; project: string | undefined; context: string[]; file: string[]; agent: string | undefined; };
}

export async function runFeedback(ctx: CommandContext<"optional">, { args, flags }: FeedbackInput): Promise<void> {
  const { ui, json, interactive } = ctx;
  let message = args.message;

  if (!message && interactive) {
    ui.intro("Superwall feedback");
    const answer = await ui.text({
      message: "What's your feedback on Superwall?",
      placeholder: "What worked, what didn't, what's missing...",
      validate: (v) => (v?.trim() ? undefined : "Required"),
    });
    if (answer === null) return void ui.warn("Cancelled.");
    message = answer.trim();
  }
  if (!message) {
    throw new Error(
      'Usage: superwall feedback "<message>" [--title ...] [--kind bug] [--file log.txt]',
    );
  }

  const kind = FEEDBACK_KINDS.find((candidate) => candidate === flags.kind);
  if (!kind) throw new Error(`--kind must be one of: ${FEEDBACK_KINDS.join(", ")}`);
  const agent = flags.agent ?? detectAgent();
  const attachments = readAttachments(flags.file.filter(Boolean));

  const context = parseContext(flags.context);
  const linked = linkedApp();
  const applicationId = flags.app ?? linked.applicationId;

  const via = agent || !interactive ? "agent" : "human";
  const spin = interactive ? ui.spinner() : null;
  spin?.start("Sending your feedback");
  const ok = await submitFeedback(
    {
      title: flags.title,
      message,
      kind,
      command: flags.command,
      agent,
      projectId: flags.project ?? linked.projectId,
      applicationId,
      organizationId: await organizationOfApp(ctx.api, applicationId),
      context,
      attachments,
    },
    via,
  );
  spin?.stop(ok ? "Sent" : "Failed to send");

  if (json) return ctx.output.data({ submitted: ok });
  if (!ok) {
    throw new Error("Couldn't send your feedback - check your connection and try again.");
  }
  ui.success(
    "Thank you! We've received your feedback and will read through it. Really appreciate you helping us make Superwall better.",
  );
}
