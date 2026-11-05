import { FEEDBACK_KINDS, type FeedbackKind } from "./kinds";
import type { CommandContext } from "@/program/command";
import { ApiError, ApiUnreachableError, type SuperwallApi } from "@/core/api/client";
import { appNotFound, findApplication, findProject, parseDashboardUrl } from "@/core/api/lookup";
import { orgIdOf } from "@/core/api/orgs";
import { NotLoggedInError } from "@/core/account/errors";
import { readSession } from "@/core/account/storage";
import { readAnonymousId, readOnboardedApp } from "@/core/state/config";
import { plural } from "@/core/app-store-connect/resources/operation";
import { field, isRecord, textField } from "@/core/json";
import { readInput } from "@/program/host";
import { detectAgent, TELEMETRY_HOST, TELEMETRY_KEY, VERSION } from "@/environment";

type FeedbackVia = "human" | "agent";

// The MCP and hosted agents run this in a Worker, where Node's process may be absent.
const proc = (globalThis as { process?: NodeJS.Process }).process;

export const MAX_FILES = 5;
export const MAX_FILE_CHARS = 20_000;

interface FeedbackAttachment {
  name: string;
  content: string;
  truncated: boolean;
}

interface FeedbackTarget {
  projectId?: string;
  applicationId?: string;
  organizationId?: string;
}

interface Feedback extends FeedbackTarget {
  title?: string;
  message: string;
  kind: FeedbackKind;
  useCase?: string;
  command?: string;
  agent?: string;
  context: Record<string, string>;
  attachments: FeedbackAttachment[];
}

export interface FeedbackRequest {
  id: number;
  title: string;
  kind: string;
  status: string;
  report_count: number;
  organization_count: number;
}

export interface FeedbackReport {
  object: "feedback_report";
  id: number;
  outcome: "created" | "merged";
  request: FeedbackRequest;
}

type FeedbackResult = FeedbackReport | { submitted: boolean; outcome?: "queued" };

export function parseContext(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at < 1) throw new Error(`--context expects key=value, got "${pair}"`);
    out[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  }
  return out;
}

export function readAttachments(paths: string[]): FeedbackAttachment[] {
  if (paths.length > MAX_FILES) {
    throw new Error(`Attach at most ${MAX_FILES} files.`);
  }
  return paths.map((path) => {
    const raw = readInput(path);
    const truncated = raw.length > MAX_FILE_CHARS;
    return {
      name: path === "-" ? "stdin" : (path.split(/[\\/]/).pop() ?? path),
      content: truncated ? raw.slice(-MAX_FILE_CHARS) : raw,
      truncated,
    };
  });
}

export async function resolveFeedbackTarget(
  api: SuperwallApi | undefined,
  { app, project }: { app?: string; project?: string },
  cwd = proc?.cwd() ?? "",
): Promise<FeedbackTarget> {
  if (app) {
    const dashboard = parseDashboardUrl(app);
    if (dashboard) return { applicationId: dashboard.applicationId, organizationId: dashboard.orgId, projectId: project };
    if (/^\d+$/.test(app) || !api) return { applicationId: app, projectId: project };
    const found = await findApplication(api, app).catch(() => null);
    if (found === null) return { applicationId: app, projectId: project };
    if (!found) throw appNotFound(app);
    return { applicationId: String(found.app.id), projectId: String(found.project.id), organizationId: orgIdOf(found.project) };
  }
  if (project) {
    const found = api ? await findProject(api, project).catch(() => undefined) : undefined;
    return { projectId: project, organizationId: found && orgIdOf(found) };
  }
  const linked = readOnboardedApp(cwd);
  return { projectId: linked?.projectId, applicationId: linked?.applicationId };
}

const numericId = (id: string | undefined): number | undefined =>
  id !== undefined && /^\d+$/.test(id) ? Number(id) : undefined;

export function buildFeedbackBody(feedback: Feedback, via: FeedbackVia): Record<string, unknown> {
  const applicationId = numericId(feedback.applicationId);
  const context = feedback.projectId ? { project: feedback.projectId, ...feedback.context } : feedback.context;
  return {
    kind: feedback.kind,
    message: feedback.message,
    title: feedback.title,
    use_case: feedback.useCase,
    command: feedback.command,
    application_id: applicationId,
    organization_id: applicationId === undefined ? numericId(feedback.organizationId) : undefined,
    context,
    attachments: feedback.attachments,
    agent: feedback.agent,
    via,
    cli_version: VERSION,
  };
}

export function parseFeedbackReport(value: unknown): FeedbackReport | undefined {
  const request = field(value, "request");
  const outcome = field(value, "outcome");
  const id = field(value, "id");
  if (!isRecord(request) || typeof id !== "number" || (outcome !== "created" && outcome !== "merged")) return undefined;
  const count = (key: string): number => {
    const found = field(request, key);
    return typeof found === "number" ? found : 0;
  };
  const requestId = field(request, "id");
  return {
    object: "feedback_report",
    id,
    outcome,
    request: {
      id: typeof requestId === "number" ? requestId : 0,
      title: textField(request, "title") ?? "",
      kind: textField(request, "kind") ?? "other",
      status: textField(request, "status") ?? "open",
      report_count: count("report_count"),
      organization_count: count("organization_count"),
    },
  };
}

const fallsBack = (error: unknown): boolean =>
  (error instanceof ApiError && error.status !== 429) ||
  error instanceof ApiUnreachableError ||
  error instanceof NotLoggedInError ||
  error instanceof SyntaxError;

async function sendToApi(api: SuperwallApi, feedback: Feedback, via: FeedbackVia): Promise<FeedbackReport | undefined> {
  try {
    return parseFeedbackReport(await api.post<unknown>("/v2/feedback", buildFeedbackBody(feedback, via)));
  } catch (error) {
    if (fallsBack(error)) return undefined;
    throw error;
  }
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
  osRelease?: string,
  report?: FeedbackReport,
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
      use_case: feedback.useCase ?? null,
      command: feedback.command ?? null,
      project_id: feedback.projectId ?? null,
      application_id: feedback.applicationId ?? null,
      organization_id: feedback.organizationId ?? null,
      context: feedback.context,
      attachments: feedback.attachments,
      via,
      agent: feedback.agent ?? null,
      cli_version: VERSION,
      platform: proc?.platform ?? "worker",
      os_release: osRelease ?? null,
      arch: proc?.arch ?? null,
      node_version: proc?.version ?? null,
      ci: proc?.env.CI === "true",
      email: session?.userEmail ?? null,
      org_name: session?.orgName ?? null,
      auth_method: session?.authMethod ?? null,
      // Set when the feedback endpoint also took the report, so the team's feed links to it.
      feedback_report_id: report?.id ?? null,
      feedback_outcome: report?.outcome ?? null,
      feedback_request_id: report?.request.id ?? null,
      feedback_request_title: report?.request.title ?? null,
    },
  };
}

async function sendToTelemetry(feedback: Feedback, via: FeedbackVia, report?: FeedbackReport): Promise<boolean> {
  const osRelease = proc ? await import("node:os").then((os) => os.release()).catch(() => undefined) : undefined;
  const payload = buildFeedbackEvent(feedback, via, readAnonymousId(), readSession(), osRelease, report);
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

async function submitFeedback(api: SuperwallApi | undefined, feedback: Feedback, via: FeedbackVia): Promise<FeedbackResult> {
  const report = api ? await sendToApi(api, feedback, via) : undefined;
  // Always sent too: the team's feedback feed (PostHog, forwarded to Slack) reads this event.
  const submitted = await sendToTelemetry(feedback, via, report);
  if (report) return report;
  return submitted ? { submitted, outcome: "queued" } : { submitted };
}

export function formatFeedbackReport(report: FeedbackReport): string {
  const { title, report_count, organization_count } = report.request;
  if (report.outcome === "created") return `Opened a new request: '${title}'`;
  return `Merged into '${title}' (${plural(report_count, "report")} from ${plural(organization_count, "team")})`;
}

interface FeedbackInput {
  args: { message: string | undefined; };
  flags: { title: string | undefined; kind: string; useCase: string | undefined; command: string | undefined; app: string | undefined; project: string | undefined; context: string[]; file: string[]; agent: string | undefined; };
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
      'Usage: superwall feedback "<message>" [--title ...] [--kind bug] [--use-case ...] [--file log.txt]',
    );
  }

  const kind = FEEDBACK_KINDS.find((candidate) => candidate === flags.kind);
  if (!kind) throw new Error(`--kind must be one of: ${FEEDBACK_KINDS.join(", ")}`);
  const agent = flags.agent ?? detectAgent();
  const attachments = readAttachments(flags.file.filter(Boolean));
  const context = parseContext(flags.context);
  const target = await resolveFeedbackTarget(ctx.api, { app: flags.app, project: flags.project });

  const via = agent || !interactive ? "agent" : "human";
  const spin = interactive ? ui.spinner() : null;
  spin?.start("Sending your feedback");
  const result = await submitFeedback(
    ctx.api,
    { title: flags.title, message, kind, useCase: flags.useCase, command: flags.command, agent, context, attachments, ...target },
    via,
  );
  const sent = "outcome" in result;
  spin?.stop(sent ? "Sent" : "Failed to send");

  if (json) return ctx.output.data(result);
  if (!sent) {
    throw new Error("Couldn't send your feedback - check your connection and try again.");
  }
  if ("request" in result) return void ui.success(formatFeedbackReport(result));
  ui.success(
    "Thank you! We've received your feedback and will read through it. Really appreciate you helping us make Superwall better.",
  );
}
