import { readFileSync } from "node:fs";
import type { SuperwallApi } from "./client";
import { asaProxy } from "./asa";
import {
  asaActions,
  asaGroups,
  asaVariants,
  fillPath,
  placeholdersOf,
  selectVariant,
  type AsaFlag,
  type AsaOperation,
  type AsaScope,
} from "./asa-catalog";

export interface AsaPage {
  data?: unknown;
  pagination?: { totalResults?: number; startIndex?: number; itemsPerPage?: number } | null;
  error?: unknown;
}

const DEFAULT_PAGE = 1000;
const MAX_PAGES = 500;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function readJsonInput(input: string, label: string): unknown {
  let text = input;
  if (input.startsWith("@")) {
    const file = input.slice(1);
    text = readFileSync(file === "-" ? 0 : file, "utf8");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid ${label} - expected JSON (inline, @file, or @- for stdin).`);
  }
}

export function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function numeric(value: unknown, label: string): number {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) throw new Error(`--${label} must be a number.`);
  return n;
}

function idValue(id: string): number | string {
  return /^\d+$/.test(id) ? Number(id) : id;
}

export type CurrencyResolver = () => Promise<string>;

async function convertFlag(f: AsaFlag, value: unknown, currency: CurrencyResolver): Promise<unknown> {
  switch (f.type) {
    case "string":
      return String(value);
    case "number":
      return numeric(value, f.flag);
    case "boolean":
      return value === true || value === "true";
    case "list":
      return splitList(value);
    case "money":
      return { amount: String(value), currency: await currency() };
  }
}

export interface SelectorInput {
  selector?: string;
  field?: string;
  op?: string;
  values?: string;
  orderBy?: string;
  fields?: string;
  limit?: number;
  offset?: number;
}

export function buildSelector(input: SelectorInput): Record<string, unknown> {
  const base = input.selector ? readJsonInput(input.selector, "--selector") : {};
  if (!isRecord(base)) throw new Error("--selector must be a JSON object.");
  const selector: Record<string, unknown> = { ...base };
  if (input.field || input.op || input.values) {
    if (!input.field || !input.op || !input.values) {
      throw new Error("--field, --op and --values go together (e.g. --field status --op EQUALS --values ENABLED).");
    }
    const conditions = Array.isArray(selector.conditions) ? [...selector.conditions] : [];
    conditions.push({
      field: input.field,
      operator: input.op.toUpperCase(),
      values: splitList(input.values),
    });
    selector.conditions = conditions;
  }
  if (input.orderBy) {
    const [field, dir] = input.orderBy.split(":");
    const sortOrder = (dir ?? "asc").toLowerCase().startsWith("desc") ? "DESCENDING" : "ASCENDING";
    selector.orderBy = [{ field, sortOrder }];
  }
  if (input.fields) selector.fields = splitList(input.fields);
  if (input.limit !== undefined || input.offset !== undefined) {
    selector.pagination = { offset: input.offset ?? 0, limit: input.limit ?? 20 };
  }
  return selector;
}

export interface ReportInput {
  start?: string;
  end?: string;
  granularity?: string;
  groupBy?: string;
  selector?: string;
  timeZone?: string;
  searchTerms: boolean;
}

export function buildReport(input: ReportInput): Record<string, unknown> {
  if (!input.start || !input.end) throw new Error("Reports need --start and --end (YYYY-MM-DD).");
  const report: Record<string, unknown> = {
    startTime: input.start,
    endTime: input.end,
    timeZone: input.timeZone ?? "UTC",
    returnRowTotals: true,
    returnGrandTotals: true,
    selector: input.selector
      ? readJsonInput(input.selector, "--selector")
      : { orderBy: [{ field: "localSpend", sortOrder: "DESCENDING" }] },
  };
  if (input.granularity) report.granularity = input.granularity.toUpperCase();
  else if (!input.searchTerms) report.granularity = "DAILY";
  if (input.groupBy) report.groupBy = splitList(input.groupBy);
  return report;
}

export interface AsaRunInput {
  group: string;
  action: string;
  positional?: string;
  argv: Record<string, unknown>;
  params: Record<string, unknown>;
}

export interface AsaRunOptions {
  orgId?: string;
  currency: CurrencyResolver;
}

export interface AsaRunResult {
  op: AsaOperation;
  path: string;
  response: AsaPage;
}

function flagValue(argv: Record<string, unknown>, name: string): unknown {
  return argv[name];
}

function stringFlag(argv: Record<string, unknown>, name: string): string | undefined {
  const v = argv[name];
  return v === undefined || v === null ? undefined : String(v);
}

function numberFlag(argv: Record<string, unknown>, name: string): number | undefined {
  const v = argv[name];
  return v === undefined || v === null || v === "" ? undefined : numeric(v, name);
}

async function objectBody(
  op: AsaOperation,
  argv: Record<string, unknown>,
  params: Record<string, unknown>,
  currency: CurrencyResolver,
): Promise<Record<string, unknown>> {
  const bodyInput = stringFlag(argv, "body");
  const base = bodyInput ? readJsonInput(bodyInput, "--body") : {};
  if (!isRecord(base)) throw new Error("--body must be a JSON object for this command.");
  const body: Record<string, unknown> = { ...base };
  for (const f of op.flags ?? []) {
    const v = flagValue(argv, f.flag);
    if (v === undefined || v === null || v === "") continue;
    body[f.key] = await convertFlag(f, v, currency);
  }
  Object.assign(body, params);
  return body;
}

async function arrayBody(
  op: AsaOperation,
  argv: Record<string, unknown>,
  params: Record<string, unknown>,
  ids: string[],
  currency: CurrencyResolver,
): Promise<unknown[]> {
  const bodyInput = stringFlag(argv, "body");
  if (bodyInput) {
    const parsed = readJsonInput(bodyInput, "--body");
    if (Array.isArray(parsed)) return parsed;
    if (isRecord(parsed)) return [parsed];
    throw new Error("--body must be a JSON array (or one object) for this command.");
  }
  const item = await objectBody({ ...op, envelope: undefined }, argv, params, currency);
  if (ids[0] !== undefined) item.id = idValue(ids[0]);
  if (Object.keys(item).length === 0) {
    const hint = (op.flags ?? []).map((f) => `--${f.flag}`).join(", ");
    throw new Error(`Nothing to send. Pass fields (${hint}) or --body '[...]'.`);
  }
  return [item];
}

const QUERY_NAMES: Record<string, string> = {
  fields: "fields",
  limit: "limit",
  offset: "offset",
  name: "name",
  states: "states",
  country: "countrycode",
  entity: "entity",
  countries: "countriesOrRegions",
  "device-classes": "deviceClasses",
  "language-codes": "languageCodes",
  expand: "expand",
  owned: "returnOwnedApps",
  "include-deleted-assets": "includeDeletedCreativeSetAssets",
};

function queryFor(op: AsaOperation, argv: Record<string, unknown>, positional: string | undefined): URLSearchParams {
  const qs = new URLSearchParams();
  if (op.positional === "query") {
    if (!positional) throw new Error(`asa ${op.group} ${op.action} needs a search query.`);
    qs.set("query", positional);
  }
  for (const name of op.query ?? []) {
    if (name === "all" || name === "adam-id") continue;
    const key = QUERY_NAMES[name];
    if (!key) continue;
    const v = argv[name];
    if (v === undefined || v === null || v === "" || v === false) continue;
    qs.set(key, v === true ? "true" : String(v));
  }
  return qs;
}

export function withQuery(path: string, qs: URLSearchParams | Record<string, unknown>): string {
  const params = qs instanceof URLSearchParams ? qs : new URLSearchParams();
  if (!(qs instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(qs)) {
      if (typeof value === "object" && value !== null) {
        throw new Error(`Nested -d params aren't supported on GET/DELETE (got "${key}").`);
      }
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `${path}${path.includes("?") ? "&" : "?"}${s}` : path;
}

export async function collectPages(
  fetchPage: (offset: number, limit: number) => Promise<AsaPage>,
  startOffset: number,
  limit: number,
): Promise<AsaPage> {
  const out: unknown[] = [];
  let offset = startOffset;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await fetchPage(offset, limit);
    const items = Array.isArray(page.data) ? page.data : [];
    out.push(...items);
    if (items.length === 0) break;
    offset += items.length;
    const total = page.pagination?.totalResults;
    if (typeof total === "number" && offset >= total) break;
    if (items.length < limit) break;
  }
  return {
    data: out,
    pagination: { totalResults: out.length, startIndex: startOffset, itemsPerPage: out.length },
  };
}

export function resolveOperation(input: AsaRunInput): { op: AsaOperation; scope: AsaScope } {
  const variants = asaVariants(input.group, input.action);
  if (variants.length === 0) {
    if (!asaGroups().includes(input.group)) {
      throw new Error(
        `Unknown "asa ${input.group}". Use get|post|put|delete <path>, a raw path, docs, keys, or: ${asaGroups().join(" | ")}`,
      );
    }
    throw new Error(
      `Unknown "asa ${input.group} ${input.action}". Actions: ${asaActions(input.group).join(" | ")}. Run \`superwall asa docs ${input.group}\`.`,
    );
  }
  const positional = variants[0]!.positional;
  const ids = positional === "id" || positional === "ids" ? splitList(input.positional) : [];
  const scope: AsaScope = {
    campaign: stringFlag(input.argv, "campaign"),
    adgroup: stringFlag(input.argv, "adgroup"),
    adamId: stringFlag(input.argv, "adam-id") ?? (positional === "adam-id" ? input.positional : undefined),
    ids,
    adgroupLevel: input.argv["adgroup-level"] === true,
  };
  const needsId = variants.every((v) => placeholdersOf(v.path).includes("id") || v.body === "ids");
  if ((positional === "id" || positional === "ids") && ids.length === 0 && needsId) {
    throw new Error(`asa ${input.group} ${input.action} needs an id.`);
  }
  if (positional === "adam-id" && !scope.adamId) {
    throw new Error(`asa ${input.group} ${input.action} needs an App Store app id (adamId).`);
  }
  return { op: selectVariant(variants, scope), scope };
}

export async function runAsaOperation(
  api: SuperwallApi,
  appId: string,
  input: AsaRunInput,
  options: AsaRunOptions,
): Promise<AsaRunResult> {
  const { op, scope } = resolveOperation(input);
  const path = fillPath(op.path, scope);
  const argv = input.argv;
  const proxy = <T>(method: string, p: string, body?: unknown) =>
    asaProxy<T>(api, appId, method, p, body, { orgId: options.orgId });
  const all = argv.all === true;
  const limit = numberFlag(argv, "limit");
  const offset = numberFlag(argv, "offset") ?? 0;

  if (op.body === "selector") {
    const selector = buildSelector({
      selector: stringFlag(argv, "selector"),
      field: stringFlag(argv, "field"),
      op: stringFlag(argv, "op"),
      values: stringFlag(argv, "values"),
      orderBy: stringFlag(argv, "order-by"),
      fields: stringFlag(argv, "fields"),
      limit,
      offset: numberFlag(argv, "offset"),
    });
    if (all) {
      const response = await collectPages(
        (pageOffset, pageLimit) =>
          proxy<AsaPage>(op.method, path, { ...selector, pagination: { offset: pageOffset, limit: pageLimit } }),
        offset,
        limit ?? DEFAULT_PAGE,
      );
      return { op, path, response };
    }
    return { op, path, response: await proxy<AsaPage>(op.method, path, selector) };
  }

  if (op.body === "report") {
    const report = buildReport({
      start: stringFlag(argv, "start"),
      end: stringFlag(argv, "end"),
      granularity: stringFlag(argv, "granularity"),
      groupBy: stringFlag(argv, "group-by"),
      selector: stringFlag(argv, "selector"),
      timeZone: stringFlag(argv, "time-zone"),
      searchTerms: op.action === "searchterms",
    });
    return { op, path, response: await proxy<AsaPage>(op.method, path, report) };
  }

  if (op.body === "ids") {
    return { op, path, response: await proxy<AsaPage>(op.method, path, scope.ids.map(idValue)) };
  }

  if (op.body === "geo") {
    const entity = stringFlag(argv, "entity");
    if (!entity) throw new Error("asa geo get needs --entity <Country|AdminArea|Locality>.");
    const body = scope.ids.map((id) => ({ id, entity }));
    return { op, path, response: await proxy<AsaPage>(op.method, path, body) };
  }

  if (op.body === "array") {
    const body = await arrayBody(op, argv, input.params, scope.ids, options.currency);
    return { op, path, response: await proxy<AsaPage>(op.method, path, body) };
  }

  if (op.body === "object") {
    const body = await objectBody(op, argv, input.params, options.currency);
    const payload = op.envelope ? { [op.envelope]: body } : body;
    return { op, path, response: await proxy<AsaPage>(op.method, path, payload) };
  }

  if (op.method === "GET") {
    const qs = queryFor(op, argv, input.positional);
    for (const [key, value] of Object.entries(input.params)) {
      if (typeof value === "object" && value !== null) {
        throw new Error(`Nested -d params aren't supported on GET (got "${key}").`);
      }
      qs.set(key, String(value));
    }
    if (op.paged === "query" && all) {
      const response = await collectPages(
        (pageOffset, pageLimit) => {
          const page = new URLSearchParams(qs);
          page.set("offset", String(pageOffset));
          page.set("limit", String(pageLimit));
          return proxy<AsaPage>("GET", withQuery(path, page));
        },
        offset,
        limit ?? DEFAULT_PAGE,
      );
      return { op, path, response };
    }
    return { op, path, response: await proxy<AsaPage>("GET", withQuery(path, qs)) };
  }

  return { op, path, response: (await proxy<AsaPage>(op.method, path)) ?? { data: null } };
}

export function currencyResolver(
  api: SuperwallApi,
  appId: string,
  explicit: string | undefined,
  orgId: string | undefined,
): CurrencyResolver {
  let cached: Promise<string> | undefined;
  return () => {
    if (explicit) return Promise.resolve(explicit.toUpperCase());
    cached ??= (async () => {
      const acls = await asaProxy<AsaPage>(api, appId, "GET", "/acls");
      const rows = Array.isArray(acls.data) ? acls.data.filter(isRecord) : [];
      if (orgId) {
        const match = rows.find((r) => String(r.orgId) === orgId && typeof r.currency === "string");
        if (match) return String(match.currency).toUpperCase();
      }
      const currencies = [...new Set(rows.map((r) => r.currency).filter((c): c is string => typeof c === "string"))];
      if (currencies.length === 1) return currencies[0]!.toUpperCase();
      throw new Error(
        currencies.length === 0
          ? "Couldn't determine the account currency from Apple Search Ads. Pass --currency (e.g. USD)."
          : `This API user spans several currencies (${currencies.join(", ")}). Pass --currency or --org-id.`,
      );
    })();
    return cached;
  };
}
