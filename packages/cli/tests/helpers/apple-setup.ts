import type { CommandContext, CommandDefinition } from "@/command";
import type { AppleKeyDeps } from "@/commands/platform/apple-keys";
import type { ApiError, SuperwallApi } from "@/core/api/client";
import type {
  BundleIdCandidate,
  NotificationEnvironment,
  ServerNotifications,
} from "@/core/api/integrations";
import {
  AppleError,
  type AppleSession,
  type AppleTeam,
  type IrisRequest,
  type PendingVerification,
} from "@/core/apple/session";
import { run } from "./command";
import { recordingRenderer, type RendererCall } from "./renderer";

export const PEM = "-----BEGIN PRIVATE KEY-----\nMIGT\n-----END PRIVATE KEY-----\n";
export const OURS = "https://integrations.superwall.com/integrations/app-store-connect/webhook?pk=pk_1";
export const ACME: AppleTeam = { id: 111, issuerId: "issuer-111", name: "Acme Inc" };
export const PENDING: PendingVerification = {
  appleId: "jane@example.com",
  serviceKey: "widget",
  sessionId: "session-1",
  scnt: "scnt-1",
  cookies: [],
};
export const IOS_APP = { id: 8, name: "Acme", platform: "ios", bundle_id: "com.acme.app" };

export const environment = (
  owner: NotificationEnvironment["owner"],
  url: string | null = owner === "none" ? null : OURS,
  application: NotificationEnvironment["application"] = null,
): NotificationEnvironment => ({ owner, url, token_redacted: false, application });

export const outcome = (
  status: ServerNotifications["status"],
  extra: Partial<ServerNotifications> = {},
): ServerNotifications => ({
  url: OURS,
  status,
  message: null,
  retryable: false,
  production: null,
  sandbox: null,
  ...extra,
});

export interface AppleOptions {
  twoFactor?: boolean;
  apps?: Array<{ id: string; attributes: { name: string; bundleId: string } }>;
  teams?: AppleTeam[];
  refuse?: Partial<Record<"apiKeys" | "subscriptionKeys", AppleError>>;
}

function fakeSession(options: AppleOptions, log: string[]): AppleSession {
  const teams = options.teams ?? [ACME];
  let current = teams[0]!;
  return {
    signIn: async (appleId) => {
      log.push(`signIn ${appleId}`);
      return options.twoFactor ? "verification-required" : "signed-in";
    },
    requestCode: async (request = {}) => {
      log.push(`requestCode ${request.sms ? "sms" : "device"}`);
      return request.sms
        ? { method: "sms", destination: "•••42", codeLength: 6 }
        : { method: "device", codeLength: 6 };
    },
    submitCode: async (code) => {
      log.push(`submitCode ${code}`);
      if (code !== "123456") throw new AppleError("verification", "Incorrect verification code.");
    },
    pending: () => PENDING,
    team: () => current,
    teams: () => teams,
    selectTeam: async (id) => {
      log.push(`selectTeam ${id}`);
      current = teams.find((team) => team.id === id) ?? current;
    },
    iris: async (method: string, path: string, request?: IrisRequest) => {
      if (path === "/apps") {
        const apps = options.apps ?? [
          { id: "555", attributes: { name: "Acme", bundleId: "com.acme.app" } },
        ];
        const wanted = request?.query?.["filter[bundleId]"];
        return { data: wanted ? apps.filter((app) => app.attributes.bundleId === wanted) : apps };
      }
      log.push(`iris ${method} ${path}`);
      const resource = path.split("/")[1] as "apiKeys" | "subscriptionKeys";
      const refusal = options.refuse?.[resource];
      if (refusal && method === "POST") throw refusal;
      if (method === "POST") return { data: { id: resource === "apiKeys" ? "TEAMKEY001" : "IAPKEY0001" } };
      return { data: { attributes: { privateKey: PEM } } };
    },
  };
}

export interface ApiOptions {
  projects?: unknown[];
  saved?: Record<string, unknown>;
  appVerdicts?: Array<{ valid: boolean; error: string | null }>;
  purchaseVerdict?: { valid: boolean; error: string | null };
  failAppSave?: ApiError;
  createdApps?: unknown[];
  checks?: ServerNotifications[];
  written?: ServerNotifications[];
  failCheck?: ApiError;
  candidates?: BundleIdCandidate[];
  routes?: (method: string, path: string, body?: unknown) => unknown;
}

export function fakeApi(options: ApiOptions = {}) {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const appVerdicts = [...(options.appVerdicts ?? [])];
  const checks = [...(options.checks ?? [])];
  const written = [...(options.written ?? [])];
  const handle = (method: string, path: string, body?: unknown): unknown => {
    requests.push({ method, path, ...(body === undefined ? {} : { body }) });
    const routed = options.routes?.(method, path, body);
    if (routed !== undefined) return routed;
    if (path.endsWith("/integrations/overview")) {
      return {
        revenue_provider: null,
        app_store_connect_configuration: null,
        in_app_purchase_configuration: null,
        ...options.saved,
      };
    }
    if (path.endsWith("/app-store-connect/notification-url/apple")) {
      if (options.failCheck) throw options.failCheck;
      if (method === "GET") {
        return (
          checks.shift() ??
          outcome("not_set", { production: environment("none"), sandbox: environment("none") })
        );
      }
      return (
        written.shift() ??
        outcome("set", { production: environment("this_app"), sandbox: environment("this_app") })
      );
    }
    if (path.endsWith("/integrations/app-store-connect/configuration")) {
      if (options.failAppSave) throw options.failAppSave;
      return appVerdicts.shift() ?? { valid: true, error: null };
    }
    if (path.endsWith("/integrations/in-app-purchase/configuration")) {
      return options.purchaseVerdict ?? { valid: true, error: null };
    }
    if (path.endsWith("/app-store-connect/notification-url")) return { url: OURS };
    if (path.endsWith("/bundle-id-suggestions")) {
      return { window_days: 30, available: true, candidates: options.candidates ?? [] };
    }
    if (path.endsWith("/bundle-id") && method === "POST") {
      const sent = body as { bundle_id: string };
      return { bundle_id: sent.bundle_id, app_store_id: null };
    }
    if (path === "/v2/projects") return { id: 70 };
    if (/^\/v2\/projects\/\d+\/applications$/.test(path)) {
      const projectId = Number(path.split("/")[3]);
      const sent = body as { name: string; bundle_id: string };
      return {
        id: projectId,
        applications: options.createdApps ?? [
          { id: 3, name: "Android", platform: "android", bundle_id: sent.bundle_id },
          { id: 99, name: sent.name, platform: "ios", bundle_id: sent.bundle_id },
        ],
      };
    }
    throw new Error(`unhandled ${method} ${path}`);
  };
  const api: Partial<SuperwallApi> = {
    org: { id: "9", name: "Org", count: 1 },
    host: "https://api.example.com",
    list: async () => (options.projects ?? [{ id: 5, name: "Main", applications: [IOS_APP] }]) as never[],
    get: async (path) => handle("GET", path) as never,
    post: async (path, body) => handle("POST", path, body) as never,
    put: async (path, body) => handle("PUT", path, body) as never,
    patch: async (path, body) => handle("PATCH", path, body) as never,
    del: async (path) => handle("DELETE", path) as never,
  };
  return { api, requests };
}

export interface Scenario {
  apple?: AppleOptions;
  api?: ApiOptions;
  argv?: Record<string, unknown>;
  credentials?: { appleId?: string; password?: string };
  stored?: PendingVerification;
  interactive?: boolean;
  answers?: {
    text?: Array<string | null>;
    select?: Array<string | null>;
    confirm?: Array<boolean | null>;
  };
}

export async function scenario(
  name: string,
  command: (ctx: CommandContext<"required">, deps: AppleKeyDeps) => void | Promise<void>,
  options: Scenario = {},
) {
  const log: string[] = [];
  const sleeps: number[] = [];
  const files: Record<string, string> = {};
  const sessions: Array<PendingVerification | undefined> = [];
  let stored = options.stored;
  const deps: AppleKeyDeps = {
    session: (sessionOptions) => {
      sessions.push(sessionOptions?.pending);
      return fakeSession(options.apple ?? {}, log);
    },
    pending: {
      load: () => stored,
      save: (pending) => {
        stored = pending;
      },
      clear: () => {
        stored = undefined;
      },
    },
    credentials: () => options.credentials ?? { appleId: "jane@example.com", password: "hunter2" },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    writeKeyFile: (file, privateKey) => {
      files[file] = privateKey;
      return `/tmp/${file}`;
    },
  };
  const { api, requests } = fakeApi(options.api);
  const calls: RendererCall[] = [];
  const text = [...(options.answers?.text ?? [])];
  const select = [...(options.answers?.select ?? [])];
  const confirm = [...(options.answers?.confirm ?? [])];
  const renderer = {
    ...recordingRenderer(calls),
    text: async (value: unknown) => (calls.push({ method: "text", value }), text.shift() ?? null),
    select: async (value: unknown) => (calls.push({ method: "select", value }), select.shift() ?? null),
    confirm: async (value: unknown) => (calls.push({ method: "confirm", value }), confirm.shift() ?? null),
  };
  const definition: CommandDefinition<"required"> = {
    name,
    auth: "required",
    output: "both",
    run: (ctx) => command(ctx, deps),
  };
  const result = await run(definition, {
    argv: options.argv,
    api,
    interactive: options.interactive ?? false,
    renderer,
  });
  return {
    result,
    calls,
    log,
    sleeps,
    files,
    sessions,
    requests,
    pending: () => stored,
    said: (method: string) =>
      calls
        .filter((call) => call.method === method)
        .map((call) => String(call.value ?? "").replace(/\u001B\[[0-9;]*m/g, "")),
    wrote: (method: string, fragment: string) =>
      requests.filter((request) => request.method === method && request.path.includes(fragment)),
  };
}
