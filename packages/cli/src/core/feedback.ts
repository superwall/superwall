import { readFileSync } from "node:fs";
import { arch, release } from "node:os";
import { basename } from "node:path";
import { TELEMETRY_HOST, TELEMETRY_KEY, VERSION } from "@/environment";
import { loadSession } from "@/core/auth/storage";
import { getAnonymousId, getOnboardedApp } from "@/core/state/config";

export type FeedbackVia = "human" | "agent";
export const FEEDBACK_KINDS = ["bug", "docs", "idea", "praise", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const MAX_FILES = 5;
export const MAX_FILE_CHARS = 20_000;

export interface FeedbackAttachment {
  name: string;
  content: string;
  truncated: boolean;
}

export interface Feedback {
  title?: string;
  message: string;
  kind: FeedbackKind;
  command?: string;
  agent?: string;
  projectId?: string;
  applicationId?: string;
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

export function linkedApp(cwd = process.cwd()): {
  projectId?: string;
  applicationId?: string;
} {
  const app = getOnboardedApp(cwd);
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

/** Reads `--file` paths (`-` = stdin), keeping the base name and the tail of long logs. */
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
    orgId?: string;
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
      org_id: session?.orgId ?? null,
      org_name: session?.orgName ?? null,
      auth_method: session?.authMethod ?? null,
    },
  };
}

export async function submitFeedback(feedback: Feedback, via: FeedbackVia): Promise<boolean> {
  if (!TELEMETRY_KEY()) return false;
  const payload = buildFeedbackEvent(feedback, via, getAnonymousId(), loadSession());
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
