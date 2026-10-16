import { defineCommand, type CommandContext } from "@/command";
import { findApplication } from "@/core/api/lookup";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import { asaProxy, listAsaApps, pickAsaApp, toAsaApp, type AsaApp } from "@/core/api/asa";
import { asaGroups, type AsaOperation } from "@/core/api/asa-catalog";
import {
  renderAsaCatalog,
  renderAsaGroup,
  renderAsaOperationDocs,
  renderAsaSearch,
} from "@/core/api/asa-docs";
import {
  currencyResolver,
  readJsonInput,
  runAsaOperation,
  withQuery,
  type AsaPage,
} from "@/core/api/asa-ops";
import { parseParams } from "@/commands/platform/params";
import { apiCall, emitJson } from "@/commands/api-output";

const VERBS = new Set(["get", "post", "put", "delete"]);

const CONNECT_HINT =
  "Connect Apple Search Ads in the dashboard: open the app → Integrations → Apple Search Ads → Advanced, paste the public key into Apple's Account Settings → API, then enter the Client ID, Team ID and Key ID.";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function describeAppleError(error: ApiError, request: string): Error | undefined {
  let parsed: unknown;
  try {
    parsed = error.body ? JSON.parse(error.body) : undefined;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (parsed.error === "credentials_not_found" || parsed.error === "invalid_credentials") {
    return new Error(`${error.message}\n${CONNECT_HINT}`);
  }
  const apple =
    isRecord(parsed.error) && Array.isArray(parsed.error.errors) ? parsed.error.errors : undefined;
  if (!apple || apple.length === 0) return undefined;
  const lines = apple.filter(isRecord).map((e) => {
    const field = typeof e.field === "string" && e.field ? `${e.field}: ` : "";
    const code = typeof e.messageCode === "string" && e.messageCode ? ` (${e.messageCode})` : "";
    return `  • ${field}${String(e.message ?? "")}${code}`;
  });
  return new Error(`Apple Search Ads rejected ${request} (${error.status}):\n${lines.join("\n")}`);
}

async function withAppleErrors<T>(request: string, work: () => Promise<T>): Promise<T> {
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

async function resolveApp(
  ctx: CommandContext,
  base: SuperwallApi,
): Promise<{ app: AsaApp; api: SuperwallApi }> {
  const flag = ctx.argv.app as string | undefined;
  let apps = await apiCall(ctx, "Finding Apple Search Ads", () => listAsaApps(base));
  if (flag && !apps.some((a) => a.id === flag || a.name === flag)) {
    const found = await findApplication(base, flag);
    if (found) apps = [...apps, toAsaApp(found.project, found.app)];
  }
  const app = pickAsaApp(apps, flag);
  if (!app.organizationId) throw new Error(`Couldn't tell which account app ${app.id} belongs to.`);
  return { app, api: base.forOrg(app.organizationId) };
}

function rowLabel(row: Record<string, unknown>): string {
  for (const key of ["name", "text", "appName", "displayName", "orgName", "productPageId"]) {
    const v = row[key];
    if (typeof v === "string" && v) return v;
  }
  return String(row.id ?? row.adamId ?? "");
}

function rowMeta(row: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of [
    "status",
    "servingStatus",
    "matchType",
    "state",
    "type",
    "countryOrRegion",
    "currency",
  ]) {
    const v = row[key];
    if (typeof v === "string" && v) parts.push(v);
  }
  const bid = row.bidAmount ?? row.dailyBudgetAmount ?? row.defaultBidAmount;
  if (isRecord(bid) && bid.amount !== undefined)
    parts.push(`${String(bid.amount)} ${String(bid.currency ?? "")}`.trim());
  const id = row.id ?? row.adamId ?? row.orgId;
  if (id !== undefined) parts.push(String(id));
  return parts.join("  ");
}

function renderResult(ctx: CommandContext, op: AsaOperation, response: AsaPage): void {
  if (ctx.json) return emitJson(ctx, response);
  const rows = Array.isArray(response.data) ? response.data.filter(isRecord) : undefined;
  const listing =
    op.action === "list" ||
    op.action === "find" ||
    op.action === "search" ||
    op.action === "assets";
  if (!rows || !listing) return ctx.output.data(response);
  if (rows.length === 0) return ctx.ui.step(`No ${op.group} found`);
  const total = response.pagination?.totalResults;
  const count =
    typeof total === "number" && total > rows.length
      ? `${rows.length} of ${total}`
      : String(rows.length);
  ctx.ui.step(`${count} ${op.group}`);
  for (const row of rows) ctx.ui.info(`\`${rowLabel(row)}\`  ${rowMeta(row)}`);
}

async function runKeys(ctx: CommandContext, api: SuperwallApi): Promise<void> {
  const action = (ctx.argv.action as string | undefined) ?? "list";
  if (action !== "list") {
    throw new Error(
      `Apple Search Ads credentials are managed in the dashboard, not the CLI. ${CONNECT_HINT}`,
    );
  }
  const apps = await apiCall(ctx, "Loading apps", () => listAsaApps(api));
  if (ctx.json) return emitJson(ctx, apps);
  const connected = apps.filter((a) => a.connected);
  if (connected.length === 0) {
    ctx.ui.step("No app has Apple Search Ads connected");
    ctx.ui.info(CONNECT_HINT);
    return;
  }
  ctx.ui.step(
    `${connected.length} of ${apps.length} iOS app${apps.length === 1 ? "" : "s"} connected to Apple Search Ads`,
  );
  for (const app of apps) {
    ctx.ui.info(
      `\`${app.name ?? app.id}\`  ${app.connected ? "connected" : "not connected"}  ${app.id}`,
    );
  }
}

export const runAsa = defineCommand({
  name: "asa",
  auth: "required",
  output: "both",
  async run(ctx) {
    const target = String(ctx.argv.target ?? "");
    const action = ctx.argv.action as string | undefined;
    const value = ctx.argv.value as string | undefined;

    if (target === "docs") {
      const md = !action
        ? renderAsaCatalog()
        : value
          ? await apiCall(ctx, "Fetching Apple's documentation", () =>
              renderAsaOperationDocs(action, value),
            )
          : asaGroups().includes(action)
            ? renderAsaGroup(action)
            : renderAsaSearch(action);
      if (ctx.json) return emitJson(ctx, { markdown: md });
      process.stdout.write(`${md}\n`);
      return;
    }

    if (target === "keys") return runKeys(ctx, ctx.api);

    const params = parseParams(ctx.argv.d as string[] | undefined);
    const orgId = ctx.argv["org-id"] as string | undefined;

    if (VERBS.has(target)) {
      const path = action ?? "";
      if (!path.startsWith("/")) throw new Error(`Path must start with "/", e.g. /campaigns`);
      const { app, api } = await resolveApp(ctx, ctx.api);
      const bodyInput = ctx.argv.body as string | undefined;
      const request = `${target.toUpperCase()} ${path}`;
      const res = await withAppleErrors(request, () =>
        apiCall(ctx, request, () => {
          if (target === "get" || target === "delete") {
            return asaProxy<AsaPage>(api, app.id, target, withQuery(path, params), undefined, {
              orgId,
            });
          }
          const body = bodyInput ? readJsonInput(bodyInput, "--body") : params;
          const payload = isRecord(body) ? { ...body, ...params } : body;
          return asaProxy<AsaPage>(api, app.id, target, path, payload, { orgId });
        }),
      );
      return emitJson(ctx, res ?? { ok: true });
    }

    if (target.startsWith("/")) {
      const { app, api } = await resolveApp(ctx, ctx.api);
      const request = `GET ${target}`;
      const res = await withAppleErrors(request, () =>
        apiCall(ctx, request, () =>
          asaProxy<AsaPage>(api, app.id, "GET", withQuery(target, params), undefined, { orgId }),
        ),
      );
      return emitJson(ctx, res);
    }

    const { app, api } = await resolveApp(ctx, ctx.api);
    const input = {
      group: target,
      action: action ?? (target === "me" ? "get" : "list"),
      positional: value,
      argv: ctx.argv as Record<string, unknown>,
      params,
    };
    const currency = currencyResolver(api, app.id, ctx.argv.currency as string | undefined, orgId);
    const label = `asa ${input.group} ${input.action}`;
    const result = await withAppleErrors(label, () =>
      apiCall(ctx, label, () => runAsaOperation(api, app.id, input, { orgId, currency })),
    );
    renderResult(ctx, result.op, result.response);
  },
});
