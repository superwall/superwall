import type { CommandContext } from "@/program/command";
import { listAsaApps } from "@/core/apple-search-ads/client";
import { ApiError, withQuery, type SuperwallApi } from "@/core/api/client";
import { findApplication } from "@/core/api/lookup";
import { parseParams } from "@/core/api/params";
import { isRecord, parseJson } from "@/core/json";
import { apiCall } from "@/ui/spinner";
import { asaProxy, pickAsaApp, toAsaApp, type AsaApp } from "./client";
import { readJsonInput, type AsaPage } from "./operations";

type AsaVerb = "get" | "post" | "put" | "delete";

export const CONNECT_HINT =
  "Connect Apple Search Ads in the dashboard: open the app → Integrations → Apple Search Ads → Advanced, paste the public key into Apple's Account Settings → API, then enter the Client ID, Team ID and Key ID.";

function describeAppleError(error: ApiError, request: string): Error | undefined {
  const parsed = error.body ? parseJson(error.body) : undefined;
  if (!isRecord(parsed)) return undefined;
  if (parsed.error === "credentials_not_found" || parsed.error === "invalid_credentials") {
    return new Error(`${error.message}\n${CONNECT_HINT}`);
  }
  const lines = appleErrorLines(parsed.error);
  if (lines.length === 0) return undefined;
  return new Error(`Apple Search Ads rejected ${request} (${error.status}):\n${lines.join("\n")}`);
}

function appleErrorLines(error: unknown): string[] {
  if (!isRecord(error)) return [];
  if (Array.isArray(error.errors)) {
    return error.errors.filter(isRecord).map((e) => {
      const field = typeof e.field === "string" && e.field ? `${e.field}: ` : "";
      const code = typeof e.messageCode === "string" && e.messageCode ? ` (${e.messageCode})` : "";
      return `  • ${field}${String(e.message ?? "")}${code}`;
    });
  }
  if (typeof error.code !== "string") return [];
  const details = Array.isArray(error.details) ? error.details.filter(isRecord) : [];
  if (details.length === 0) return [`  • ${String(error.message ?? error.code)} (${error.code})`];
  return details.map((d) => {
    const info = isRecord(d.info) ? d.info : {};
    const field = typeof info.field === "string" && info.field ? `${info.field}: ` : "";
    const code = typeof d.code === "string" && d.code ? ` (${d.code})` : "";
    return `  • ${field}${String(d.message ?? error.message ?? "")}${code}`;
  });
}

export async function withAppleErrors<T>(request: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiError) {
      const better = describeAppleError(error, request);
      if (better) throw better;
    }
    throw error;
  }
}

export async function resolveAsaApp(
  ctx: CommandContext,
  base: SuperwallApi,
): Promise<{ app: AsaApp; api: SuperwallApi }> {
  const flag = ctx.target.app;
  let apps = await apiCall(ctx, "Finding Apple Search Ads", () => listAsaApps(base));
  if (flag && !apps.some((a) => a.id === flag || a.name === flag)) {
    const found = await findApplication(base, flag);
    if (found) apps = [...apps, toAsaApp(found.project, found.app)];
  }
  const app = pickAsaApp(apps, flag);
  if (!app.organizationId) throw new Error(`Couldn't tell which account app ${app.id} belongs to.`);
  return { app, api: base.forOrg(app.organizationId) };
}

export async function runAsaRequest(
  ctx: CommandContext,
  base: SuperwallApi,
  request: { verb: AsaVerb; path: string; data: string[]; body?: string; adAccountId?: string },
): Promise<AsaPage | undefined> {
  const { verb, path, adAccountId } = request;
  const params = parseParams(request.data);
  if (!path.startsWith("/")) throw new Error(`Path must start with "/", e.g. /campaigns`);
  const { app, api } = await resolveAsaApp(ctx, base);
  const label = `${verb.toUpperCase()} ${path}`;
  return withAppleErrors(label, () => {
    return apiCall(ctx, label, () => {
      if (verb === "get" || verb === "delete") {
        return asaProxy<AsaPage | undefined>(api, app.id, verb, withQuery(path, params), undefined, { adAccountId });
      }
      const body = request.body ? readJsonInput(request.body, "--body") : params;
      const payload = isRecord(body) ? { ...body, ...params } : body;
      return asaProxy<AsaPage | undefined>(api, app.id, verb, path, payload, { adAccountId });
    });
  });
}

interface AsaKeysInput {
  args: { action: string | undefined; };
}

export async function runAsaKeys(ctx: CommandContext<"required">, { args }: AsaKeysInput): Promise<void> {
  if ((args.action ?? "list") !== "list") {
    throw new Error(`Apple Search Ads credentials are managed in the dashboard, not the CLI. ${CONNECT_HINT}`);
  }
  const apps = await apiCall(ctx, "Loading apps", () => listAsaApps(ctx.api));
  if (ctx.json) return ctx.output.data(apps);
  const connected = apps.filter((a) => a.connected);
  if (connected.length === 0) {
    ctx.ui.step("No app has Apple Search Ads connected");
    ctx.ui.info(CONNECT_HINT);
    return;
  }
  ctx.ui.step(`${connected.length} of ${apps.length} iOS app${apps.length === 1 ? "" : "s"} connected to Apple Search Ads`);
  for (const app of apps) {
    ctx.ui.info(`\`${app.name ?? app.id}\`  ${app.connected ? "connected" : "not connected"}  ${app.id}`);
  }
}
