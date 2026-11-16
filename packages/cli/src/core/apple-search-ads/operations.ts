import { readInput } from "@/program/host";
import { type SuperwallApi, withQuery } from "@/core/api/client";
import { isRecord } from "@/core/json";
import {
  asaActions,
  asaGroups,
  asaVariants,
  fillPath,
  filterValue,
  placeholdersOf,
  selectVariant,
  type AsaFlag,
  type AsaOperation,
  type AsaScope,
} from "./catalog";
import { asaProxy } from "./client";

export interface AsaPage {
  result?: unknown;
  pagination?: { offset?: number; pageSize?: number; totalCount?: number } | null;
  error?: unknown;
}

const DEFAULT_PAGE = 1000;
const MAX_PAGES = 500;

export function readJsonInput(input: unknown, label: string): unknown {
  if (typeof input !== "string") return input;
  const text = input.startsWith("@") ? readInput(input.slice(1)) : input;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid ${label} - expected JSON (inline, @file, or @- for stdin).`);
  }
}

const given = (value: unknown) => value !== undefined && value !== null && value !== "";

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

export function assignField(target: Record<string, unknown>, path: string, value: unknown): void {
  const [key = "", ...rest] = path.split(".");
  if (rest.length === 0) {
    target[key] = value;
    return;
  }
  const current = target[key];
  const child: Record<string, unknown> = isRecord(current) ? { ...current } : {};
  target[key] = child;
  assignField(child, rest.join("."), value);
}

export function deepMerge(base: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const current = out[key];
    out[key] = isRecord(current) && isRecord(value) ? deepMerge(current, value) : value;
  }
  return out;
}

type CurrencyResolver = () => Promise<string>;

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

interface QueryInput {
  query?: unknown;
  field?: string;
  op?: string;
  values?: string;
  orderBy?: string;
  fields?: string;
  limit?: number;
  offset?: number;
  filters?: Record<string, unknown>[];
}

function shorthandFilter(input: QueryInput): Record<string, unknown> | undefined {
  if (!input.field && !input.op && input.values === undefined) return undefined;
  const operator = input.op?.toUpperCase();
  const valueless = operator === "IS_NULL" || operator === "IS_NOT_NULL";
  if (!input.field || !operator || (!valueless && !input.values)) {
    throw new Error("--field, --op and --values go together (e.g. --field status --op EQUALS --values ENABLED).");
  }
  if (valueless) return { field: input.field, operator };
  const values = splitList(input.values);
  const listed = ["IN", "NOT_IN", "CONTAINS_ANY", "NOT_CONTAINS_ANY", "CONTAINS_ALL", "NOT_CONTAINS_ALL", "BETWEEN"].includes(operator);
  const value = listed || values.length > 1 ? values : values[0];
  return { field: input.field, operator, value };
}

export function buildQuery(input: QueryInput): Record<string, unknown> {
  const base = given(input.query) ? readJsonInput(input.query, "--query") : {};
  if (!isRecord(base)) throw new Error("--query must be a JSON object.");
  const request: Record<string, unknown> = { ...base };
  const own = Array.isArray(base.filters) ? base.filters : [];
  const shorthand = shorthandFilter(input);
  const filters = [...own, ...(input.filters ?? []), ...(shorthand ? [shorthand] : [])];
  if (filters.length) request.filters = filters;
  if (input.orderBy) {
    const [field, dir] = input.orderBy.split(":");
    const order = (dir ?? "asc").toLowerCase().startsWith("desc") ? "DESC" : "ASC";
    request.sorting = [{ field, order }];
  }
  if (input.fields) request.fields = splitList(input.fields);
  if (input.limit !== undefined || input.offset !== undefined) {
    const own = isRecord(base.pagination) ? base.pagination : {};
    request.pagination = { ...own, offset: input.offset ?? 0, pageSize: input.limit ?? 20 };
  }
  return request;
}

interface ReportInput extends QueryInput {
  start?: string;
  end?: string;
  granularity?: string;
  groupBy?: string;
  timeZone?: string;
  zoned: boolean;
}

export function buildReport(input: ReportInput): Record<string, unknown> {
  const report = buildQuery(input);
  const range: Record<string, unknown> = isRecord(report.timeRange) ? { ...report.timeRange } : {};
  if (input.start) range.start = input.start;
  if (input.end) range.end = input.end;
  if (!range.start || !range.end) throw new Error("Reports need --start and --end (YYYY-MM-DD).");
  if (input.granularity) range.granularity = input.granularity.toUpperCase();
  else range.granularity ??= "DAILY";
  if (input.timeZone) range.timeZone = input.timeZone;
  else if (input.zoned) range.timeZone ??= "UTC";
  report.timeRange = range;
  if (input.groupBy) report.groupBy = splitList(input.groupBy);
  return report;
}

interface AsaRunInput {
  group: string;
  action: string;
  positional?: string;
  flags: Record<string, unknown>;
  params: Record<string, unknown>;
}

export interface AsaAccount {
  id: () => Promise<string>;
  currency: CurrencyResolver;
}

interface AsaRunOptions {
  adAccountId?: string;
  account: AsaAccount;
}

interface AsaRunResult {
  op: AsaOperation;
  path: string;
  response: AsaPage;
}

function flagValue(flags: Record<string, unknown>, name: string): unknown {
  return flags[name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())];
}

function stringFlag(flags: Record<string, unknown>, name: string): string | undefined {
  const v = flagValue(flags, name);
  return v === undefined || v === null ? undefined : String(v);
}

function numberFlag(flags: Record<string, unknown>, name: string): number | undefined {
  const v = flagValue(flags, name);
  return v === undefined || v === null || v === "" ? undefined : numeric(v, name);
}

async function fieldsOf(op: AsaOperation, flags: Record<string, unknown>, currency: CurrencyResolver): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {};
  for (const f of op.flags ?? []) {
    const v = flagValue(flags, f.flag);
    if (v === undefined || v === null || v === "") continue;
    assignField(data, f.key, await convertFlag(f, v, currency));
  }
  return data;
}

async function objectBody(
  op: AsaOperation,
  flags: Record<string, unknown>,
  params: Record<string, unknown>,
  body: unknown,
  options: AsaRunOptions,
): Promise<Record<string, unknown>> {
  if (body !== undefined && !isRecord(body)) throw new Error("--body must be a JSON object for this command.");
  let out = deepMerge(op.defaults ?? {}, body ?? {});
  out = deepMerge(out, await fieldsOf(op, flags, options.account.currency));
  out = deepMerge(out, params);
  if (op.account && out[op.account] === undefined) {
    const id = idValue(await options.account.id());
    out[op.account] = op.account === "adAccountIds" ? [id] : id;
  }
  return out;
}

const bulkItem = (data: unknown, index: number) => {
  if (isRecord(data) && isRecord(data.data)) return { correlationId: index, ...data };
  return { correlationId: index, data };
};

async function bulkBody(
  op: AsaOperation,
  flags: Record<string, unknown>,
  params: Record<string, unknown>,
  body: unknown,
  ids: string[],
  currency: CurrencyResolver,
): Promise<Record<string, unknown>> {
  if (isRecord(body) && Array.isArray(body.items)) return body;
  if (Array.isArray(body)) return { items: body.map(bulkItem) };
  if (body !== undefined && !isRecord(body)) throw new Error("--body must be a JSON array (or one object) for this command.");
  const data = deepMerge(deepMerge(body ?? {}, await fieldsOf(op, flags, currency)), params);
  if (Object.keys(data).length === 0) {
    const hint = (op.flags ?? []).map((f) => `--${f.flag}`).join(", ");
    throw new Error(`Nothing to send. Pass fields (${hint}) or --body '[...]'.`);
  }
  if (ids.length) return { items: ids.map((id, index) => bulkItem({ ...data, id: idValue(id) }, index)) };
  return { items: [bulkItem(data, 0)] };
}

function arrayBody(op: AsaOperation, body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (isRecord(body)) return [body];
  throw new Error(`asa ${op.group} ${op.action} needs --body '[...]', as Apple documents it.`);
}

const QUERY_NAMES: Record<string, string> = {
  limit: "limit",
  offset: "offset",
  owned: "returnOwnedApps",
  "store-fronts": "storeFronts",
  country: "countrycode",
  entity: "entity",
  "supply-source": "supplySource",
  eligible: "eligible",
  "resource-type": "resourceType",
};

function queryFor(op: AsaOperation, flags: Record<string, unknown>, positional: string | undefined): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(op.defaults ?? {})) qs.set(key, String(value));
  if (op.positional === "query") {
    if (!positional) throw new Error(`asa ${op.group} ${op.action} needs a search query.`);
    qs.set("query", positional);
  }
  for (const name of op.query ?? []) {
    const key = name === "limit" ? (op.pageSize ?? "limit") : QUERY_NAMES[name];
    if (!key) continue;
    const v = flagValue(flags, name);
    if (v === undefined || v === null || v === "" || v === false) continue;
    qs.set(key, v === true ? "true" : String(v));
  }
  return qs;
}

function scopeFilters(op: AsaOperation, scope: AsaScope): Record<string, unknown>[] {
  return (op.filters ?? []).flatMap((filter) => {
    const value = filterValue(filter, scope);
    if (!value) return [];
    const typed = filter.text ? value : idValue(value);
    return [{ field: filter.field, operator: "EQUALS", value: filter.list ? [typed] : typed }];
  });
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
    const items = Array.isArray(page.result) ? page.result : [];
    out.push(...items);
    if (items.length === 0) break;
    offset += items.length;
    const total = page.pagination?.totalCount;
    if (typeof total === "number" && offset >= total) break;
    if (items.length < limit) break;
  }
  return {
    result: out,
    pagination: { offset: startOffset, pageSize: out.length, totalCount: out.length },
  };
}

const isBulkBody = (body: unknown) => Array.isArray(body) || (isRecord(body) && Array.isArray(body.items));

export function resolveOperation(input: AsaRunInput, body?: unknown): { op: AsaOperation; scope: AsaScope } {
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
  const positional = variants[0]?.positional;
  const ids = positional === "id" || positional === "ids" ? splitList(input.positional) : [];
  const bulk = variants.some((v) => v.body === "bulk") && isBulkBody(body);
  const scope: AsaScope = {
    campaign: stringFlag(input.flags, "campaign"),
    adgroup: stringFlag(input.flags, "adgroup"),
    adamId: stringFlag(input.flags, "adam-id") ?? (positional === "adam-id" ? input.positional : undefined),
    ids,
    bulk,
  };
  const needsId = variants.every((v) => placeholdersOf(v.path).includes("id") || v.body === "bulk");
  if ((positional === "id" || positional === "ids") && ids.length === 0 && needsId && !bulk) {
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
  const flags = input.flags;
  const bodyInput = flagValue(flags, "body");
  const body = given(bodyInput) ? readJsonInput(bodyInput, "--body") : undefined;
  const { op, scope } = resolveOperation(input, body);
  const path = fillPath(op.path, scope);
  const proxy = <T>(method: string, p: string, payload?: unknown) => {
    return asaProxy<T>(api, appId, method, p, payload, { adAccountId: options.adAccountId });
  };
  const all = flags.all === true;
  const limit = numberFlag(flags, "limit");
  const offset = numberFlag(flags, "offset") ?? 0;
  const send = async (payload: unknown) => ({ op, path, response: await proxy<AsaPage>(op.method, path, payload) });

  if (op.body === "query" || op.body === "report") {
    const query: QueryInput = {
      query: flagValue(flags, "query"),
      field: stringFlag(flags, "field"),
      op: stringFlag(flags, "op"),
      values: stringFlag(flags, "values"),
      orderBy: stringFlag(flags, "order-by"),
      fields: stringFlag(flags, "fields"),
      limit,
      offset: numberFlag(flags, "offset"),
      filters: scopeFilters(op, scope),
    };
    const request =
      op.body === "report"
        ? buildReport({
            ...query,
            start: stringFlag(flags, "start"),
            end: stringFlag(flags, "end"),
            granularity: stringFlag(flags, "granularity"),
            groupBy: stringFlag(flags, "group-by"),
            timeZone: stringFlag(flags, "time-zone"),
            zoned: op.zoned === true,
          })
        : buildQuery(query);
    if (!all) return send(request);
    const response = await collectPages(
      (pageOffset, pageSize) => {
        return proxy<AsaPage>(op.method, path, { ...request, pagination: { offset: pageOffset, pageSize, fetchTotalCount: true } });
      },
      offset,
      limit ?? DEFAULT_PAGE,
    );
    return { op, path, response };
  }

  if (op.body === "bulk") {
    if (op.flags === undefined) {
      if (isBulkBody(body)) return send(await bulkBody(op, {}, {}, body, [], options.account.currency));
      return send({ items: scope.ids.map((id, index) => bulkItem({ id: idValue(id) }, index)) });
    }
    return send(await bulkBody(op, flags, input.params, body, scope.ids, options.account.currency));
  }

  if (op.body === "array") return send(arrayBody(op, body));

  if (op.body === "geo") {
    const entity = stringFlag(flags, "entity");
    if (!entity) throw new Error("asa geo get needs --entity <Country|AdminArea|Locality>.");
    const request: Record<string, unknown> = {
      geoRequest: scope.ids.map((id) => ({ id, entity })),
      supplySource: stringFlag(flags, "supply-source") ?? "APPSTORE",
    };
    if (limit !== undefined || numberFlag(flags, "offset") !== undefined) request.pagination = { offset, pageSize: limit ?? 20 };
    return send(request);
  }

  if (op.body === "object") return send(await objectBody(op, flags, input.params, body, options));

  if (op.method === "GET") {
    const qs = queryFor(op, flags, input.positional);
    for (const [key, value] of Object.entries(input.params)) {
      if (typeof value === "object" && value !== null) {
        throw new Error(`Nested -d params aren't supported on GET (got "${key}").`);
      }
      qs.set(key, String(value));
    }
    if (op.paged && all) {
      const sizeParam = op.pageSize ?? "limit";
      const response = await collectPages(
        (pageOffset, pageLimit) => {
          const page = new URLSearchParams(qs);
          page.set("offset", String(pageOffset));
          page.set(sizeParam, String(pageLimit));
          return proxy<AsaPage>("GET", withQuery(path, page));
        },
        offset,
        limit ?? DEFAULT_PAGE,
      );
      return { op, path, response };
    }
    return { op, path, response: await proxy<AsaPage>("GET", withQuery(path, qs)) };
  }

  return { op, path, response: (await proxy<AsaPage>(op.method, path)) ?? { result: null } };
}

function aclAccounts(acls: AsaPage | undefined): Record<string, unknown>[] {
  const result = acls && isRecord(acls.result) ? acls.result : {};
  const rows = Array.isArray(result.acls) ? result.acls.filter(isRecord) : [];
  return rows.map((r) => r.adAccount).filter(isRecord);
}

const currencyOf = (account: Record<string, unknown> | undefined) => {
  return account && typeof account.currency === "string" && account.currency ? account.currency.toUpperCase() : undefined;
};

export function accountResolver(
  api: SuperwallApi,
  appId: string,
  explicitCurrency: string | undefined,
  adAccountId: string | undefined,
): AsaAccount {
  let accounts: Promise<Record<string, unknown>[]> | undefined;
  let cachedCurrency: Promise<string> | undefined;
  const choose = async (forCurrency: boolean): Promise<Record<string, unknown>> => {
    accounts ??= asaProxy<AsaPage>(api, appId, "GET", "/acls").then(aclAccounts);
    const list = await accounts;
    const account = adAccountId ? list.find((a) => String(a.id) === adAccountId) : list.length === 1 ? list[0] : undefined;
    if (account) return account;
    const ids = list.map((a) => String(a.id)).join(", ");
    if (adAccountId) {
      const reach = ids ? ` It reaches: ${ids}.` : "";
      const skip = forCurrency ? " Pass --currency (e.g. USD) to skip the lookup." : "";
      throw new Error(`This API user can't reach ad account ${adAccountId}.${reach}${skip}`);
    }
    if (!ids) throw new Error(`This API user can't reach any Apple Ads ad account.${forCurrency ? " Pass --currency (e.g. USD)." : ""}`);
    throw new Error(`This API user reaches several ad accounts (${ids}). Pass --ad-account-id${forCurrency ? " or --currency" : ""}.`);
  };
  return {
    id: async () => adAccountId ?? String((await choose(false)).id),
    currency: () => {
      if (explicitCurrency) return Promise.resolve(explicitCurrency.toUpperCase());
      cachedCurrency ??= (async () => {
        const account = await choose(true);
        const listed = currencyOf(account);
        if (listed) return listed;
        const id = String(account.id);
        const detail = await asaProxy<AsaPage>(api, appId, "GET", `/ad-accounts/${encodeURIComponent(id)}`, undefined, {
          adAccountId: id,
        });
        const currency = currencyOf(detail && isRecord(detail.result) ? detail.result : undefined);
        if (!currency) throw new Error(`Couldn't read ad account ${id}'s currency from Apple Ads. Pass --currency (e.g. USD).`);
        return currency;
      })();
      return cachedCurrency;
    },
  };
}
