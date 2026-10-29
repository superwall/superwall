import type { CommandContext } from "@/program/command";
import { boundOrganization, pickOrganization, pickScope } from "@/core/account/scope";
import { parseParams } from "@/core/api/params";
import type { DocOperation } from "@/core/api/reference";
import { RESOURCES, type ResourceName } from "@/core/api/resources";
import { testModeWarning } from "@/core/main/bundle-id";
import { apiCall } from "@/ui/spinner";
import { showApp } from "./app-view";
import {
  findSpec,
  positionalParams,
  scopeFields,
  scopeParams,
  singular,
  usageOf,
  type Operation,
  type Resource,
  type ScopeKind,
} from "./catalog";
import { create } from "./create";
import { fieldName, type ResourceFlags } from "./input";
import { list, useApp } from "./list";
import { parseRevenueProvider, updateRevenueProvider } from "./revenue-provider";
import { renderRows, renderValue, rowsOf } from "./views";

type Context = CommandContext<"required">;
type Handler = (
  ctx: Context,
  resource: Resource,
  op: Operation,
  args: string[],
  flags: ResourceFlags,
) => Promise<void>;

function withApp(ctx: Context, app: string | undefined): Context {
  return { ...ctx, target: { ...ctx.target, app } };
}

const HANDLERS: Record<string, Handler> = {
  "apps.get": (ctx, _resource, _op, args) => showApp(ctx, args[0] ?? ctx.target.app),
  "apps.update": async (ctx, resource, op, args, flags) => {
    const rest = [...args];
    const named = rest[0] && !ctx.target.app ? withApp(ctx, rest.shift()) : ctx;
    const { revenueProvider: provider, ...fields } = flags.fields;
    const others = { ...flags, fields };
    const bundleId = fields.bundleId;
    const checksBundleId = typeof bundleId === "string" && bundleId.trim() !== "";
    if (!checksBundleId && provider === undefined)
      return callOperation(named, resource, resource, op, rest, others);

    const scope = await pickScope(named, named.api, true);
    const applicationId = scope.applicationId;
    if (!applicationId) throw new Error(`${scope.projectName ?? scope.projectId} has no apps yet.`);
    const bound = withApp(named, applicationId);
    if (checksBundleId) {
      const warning = await testModeWarning(bound, bound.api, applicationId, bundleId.trim());
      if (warning && !bound.dryRun) await confirm(bound, flags.yes, warning, "Save it anyway");
    }
    if (provider === undefined) return callOperation(bound, resource, resource, op, rest, others);

    const app = { id: applicationId, name: scope.appName ?? applicationId };
    const change = await updateRevenueProvider(
      bound,
      app,
      parseRevenueProvider(provider),
      flags.yes,
    );
    if (Object.keys(fields).length > 0) {
      return callOperation(bound, resource, resource, op, rest, others, {
        revenue_provider: change,
      });
    }
    if (bound.json) bound.output.data({ application_id: app.id, revenue_provider: change });
  },
  resource: async (ctx, resource, op, args, flags) => {
    const [value, value2] = op.name === "create" ? createValues(resource, op, args, flags) : args;
    if (!isResourceName(resource.name)) throw new Error(`Unknown resource "${resource.name}".`);
    await runResource(ctx, resource.name, op.name, value, value2, flags);
  },
};

export function assertOperations(owner: Resource): void {
  for (const resource of [owner, ...(owner.nested ?? [])]) {
    const names = resource.operations.map((op) => op.name);
    if (new Set(names).size !== names.length)
      throw new Error(`${resource.name} repeats an operation name.`);
    for (const op of resource.operations) {
      if (op.handler ? !HANDLERS[op.handler] : !op.method || !op.path) {
        throw new Error(`${resource.name} ${op.name} is neither an API call nor a known handler.`);
      }
    }
  }
}

function isResourceName(name: string): name is ResourceName {
  return name === "apps" || name in RESOURCES;
}

const CREATE_FLAGS: Record<string, string[]> = {
  apps: ["name"],
  products: ["identifier"],
  entitlements: ["identifier"],
  campaigns: ["description", "placement"],
};

function createValues(
  resource: Resource,
  op: Operation,
  args: string[],
  flags: ResourceFlags,
): unknown[] {
  if (args.length > 0) {
    throw new Error(
      `Usage: superwall ${resource.name} create ${op.usage}\nRun \`superwall ${resource.name} create --help\` for its flags.`,
    );
  }
  return (CREATE_FLAGS[resource.name] ?? []).map((flag) => flags.fields[flag]);
}

async function runResource(
  ctx: Context,
  resource: ResourceName,
  action: string,
  value: unknown,
  value2: unknown,
  flags: ResourceFlags,
): Promise<void> {
  if (action === "list") return list(ctx, ctx.api, resource, flags);
  if (action === "create") return create(ctx, ctx.api, resource, value, value2, flags);
  if (action === "use" && resource === "apps") return useApp(ctx, ctx.api, value);
  if (action === "storekit" && resource === "products") {
    const { writeStoreKit } = await import("./storekit");
    return writeStoreKit(ctx, ctx.api, flags.fields.out);
  }
  throw new Error(`Unknown action "${action}" for ${resource}.`);
}

export async function runOperation(
  ctx: Context,
  owner: Resource,
  resource: Resource,
  op: Operation,
  args: string[],
  flags: ResourceFlags,
): Promise<void> {
  if (!op.handler) return callOperation(ctx, owner, resource, op, args, flags);
  const handler = HANDLERS[op.handler];
  const name =
    owner === resource
      ? `${resource.name} ${op.name}`
      : `${owner.name} ${resource.name} ${op.name}`;
  if (!handler) throw new Error(`${name} has no handler "${op.handler}".`);
  return handler(ctx, resource, op, args, flags);
}

const toFlag = (field: string): string => `--${field.replace(/_/g, "-")}`;

async function callOperation(
  context: Context,
  owner: Resource,
  resource: Resource,
  op: Operation,
  ids: string[],
  flags: ResourceFlags,
  merged: Record<string, unknown> = {},
): Promise<void> {
  const command = `superwall ${owner === resource ? "" : `${owner.name} `}${resource.name} ${op.name}`;
  const { method, path: template } = op;
  if (!method || !template) throw new Error(`${command} has no API endpoint.`);
  const spec = await apiCall(context, "Loading the API reference", () => findSpec(op));

  const args = [...ids];
  const ctx =
    owner.appArg && args[0] && !context.target.app ? withApp(context, args.shift()) : context;
  const positional = positionalParams(op);
  if (args.length < positional.length) {
    throw new Error(
      `Usage: ${command} ${usageOf(owner, op)}\nRun \`${command} --help\` for its flags.`,
    );
  }
  if (args.length > positional.length) {
    throw new Error(
      `${command} takes ${positional.length || "no"} argument${positional.length === 1 ? "" : "s"}; got "${args.slice(positional.length).join(" ")}".`,
    );
  }

  const pathValues = new Map<string, string>();
  const query: Record<string, unknown> = {};
  const queryNames = new Set(
    spec?.params.filter((param) => param.in === "query").map((param) => param.name),
  );
  for (const [index, param] of positional.entries()) {
    const value = args[index];
    if (value === undefined) continue;
    if (queryNames.has(param)) query[param] = value;
    else pathValues.set(param, value);
  }

  const body: Record<string, unknown> = {};
  const bodyFields = new Map((spec?.body ?? []).map((field) => [field.name, field]));
  const sendsBody = method !== "GET" && method !== "DELETE";
  for (const [flag, raw] of Object.entries(flags.fields)) {
    const field = fieldName(flag);
    const queryParam = spec?.params.find((param) => param.in === "query" && param.name === field);
    const bodyField = bodyFields.get(field);
    if (queryParam) query[field] = coerce(raw, queryParam.type);
    else if (bodyField) body[field] = coerce(raw, bodyField.type);
    else if (!spec) (sendsBody ? body : query)[field] = raw;
    else
      throw new Error(
        `${command} has no ${toFlag(field)}. \`${command} --help\` lists what it takes.`,
      );
  }
  Object.assign(sendsBody ? body : query, parseParams(flags.data));
  await fillScope(ctx, op, spec, pathValues, query, body);
  const missing = (spec?.params ?? []).filter((param) => {
    return param.in === "query" && param.required && query[param.name] === undefined;
  });
  if (missing.length > 0) {
    const needs = missing.map(
      (param) => `${toFlag(param.name)} <${param.type.replace(/"/g, "").replace(/ \| /g, "|")}>`,
    );
    throw new Error(`${command} needs ${needs.join(" and ")}.`);
  }

  const path = template.replace(/\{([^}]+)\}/g, (_, param: string) => {
    const value = pathValues.get(param);
    if (value === undefined) throw new Error(`${command} needs ${param}.`);
    return encodeURIComponent(value);
  });
  const url = withQuery(path, query);

  if (ctx.dryRun) {
    return renderValue(
      ctx,
      { method, path: url, ...(sendsBody ? { body } : {}) },
      "Dry run: nothing was sent",
    );
  }
  if (op.destructive) await confirm(ctx, flags.yes, `${op.summary}: ${method} ${url}`);

  const paged = op.list && spec?.params.some((param) => param.name === "starting_after");
  const response = await apiCall(ctx, `${method} ${url}`, () => {
    switch (method) {
      case "GET":
        if (paged) return ctx.api.list(url);
        return ctx.api.get(url);
      case "DELETE":
        return ctx.api.del(url);
      case "POST":
        return ctx.api.post(url, body);
      case "PUT":
        return ctx.api.put(url, body);
      case "PATCH":
        return ctx.api.patch(url, body);
    }
  });

  if (op.list)
    return renderRows(ctx, rowsOf(response), singular(resource.name).replace(/-/g, " "), flags);
  const done = method === "GET" ? undefined : `${op.summary} — done`;
  if (Object.keys(merged).length === 0) return renderValue(ctx, response, done);
  renderValue(ctx, { ...(response as Record<string, unknown>), ...merged }, done);
}

async function fillScope(
  ctx: Context,
  op: Operation,
  spec: DocOperation | undefined,
  pathValues: Map<string, string>,
  query: Record<string, unknown>,
  body: Record<string, unknown>,
): Promise<void> {
  const wanted = new Map<string, { kind: ScopeKind; assign: (value: string) => void }>();
  for (const [param, kind] of scopeParams(op)) {
    if (!pathValues.has(param))
      wanted.set(`path:${param}`, { kind, assign: (v) => pathValues.set(param, v) });
  }
  for (const field of scopeFields(op, spec)) {
    const target = field.location === "query" ? query : body;
    if (target[field.name] !== undefined) continue;
    const typed = (value: string) =>
      field.location === "query" ? value : coerce(value, field.type);
    wanted.set(`${field.location}:${field.name}`, {
      kind: field.kind,
      assign: (value) => (target[field.name] = typed(value)),
    });
  }
  if (wanted.size === 0) return;

  const kinds = new Set([...wanted.values()].map((entry) => entry.kind));
  const values: Partial<Record<ScopeKind, string>> = {};
  if (kinds.has("app") || kinds.has("project")) {
    const scope = await pickScope(ctx, ctx.api, kinds.has("app"));
    values.project = scope.projectId;
    values.app = scope.applicationId;
  }
  if (kinds.has("organization")) {
    values.organization =
      (await boundOrganization(ctx, ctx.api)) ?? (await pickOrganization(ctx, ctx.api));
  }
  for (const { kind, assign } of wanted.values()) {
    const value = values[kind];
    if (value !== undefined) assign(value);
  }
}

function coerce(raw: unknown, type: string): unknown {
  if (Array.isArray(raw)) return raw.map((item) => coerce(item, type.replace(/\[\]$/, "")));
  if (raw !== null && typeof raw === "object") return raw;
  if (type.endsWith("[]")) {
    const item = type.slice(0, -2);
    const parsed = item === "object" || item === "any" ? coerce(raw, "any") : raw;
    if (parsed !== raw) return Array.isArray(parsed) ? parsed : [parsed];
    return String(raw)
      .split(",")
      .map((part) => coerce(part.trim(), item));
  }
  const text = String(raw);
  if (/\bboolean\b/.test(type) && /^(true|false)$/.test(text)) return text === "true";
  if (/\b(number|integer)\b/.test(type) && text.trim() !== "" && !Number.isNaN(Number(text))) {
    return Number(text);
  }
  if ((type === "object" || type === "any") && /^[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (type === "null") return null;
  // A nullable field takes the literal null to clear it (`--end-at null`).
  if (text === "null" && type.split("|").some((part) => part.trim() === "null")) return null;
  return typeof raw === "number" && !/\b(number|integer)\b/.test(type) ? text : raw;
}

function withQuery(path: string, params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) qs.append(key, String(item));
    else qs.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  const text = qs.toString();
  return text ? `${path}${path.includes("?") ? "&" : "?"}${text}` : path;
}

async function confirm(
  ctx: Context,
  yes: boolean,
  what: string,
  question = `${what}?`,
): Promise<void> {
  if (yes) return;
  if (!ctx.interactive) throw new Error(`${what}\nNothing was changed. Pass --yes to go ahead.`);
  const answer = await ctx.ui.select({
    message: question,
    options: [
      { value: "no", label: "No, stop here" },
      { value: "yes", label: "Yes, go ahead" },
    ],
    initialValue: "no",
  });
  if (answer !== "yes") throw new Error("Cancelled. Nothing was changed.");
}
