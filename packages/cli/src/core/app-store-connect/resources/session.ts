import type { CommandContext } from "@/program/command";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import { isRecord, parseJson } from "@/core/json";
import { apiCall } from "@/ui/spinner";
import { ascProxy } from "../api/client";
import { resolveAscOrgApi, resolveAscTeam } from "../api/request";
import { parseDocument, type AscDocument, type AscResource } from "./json-api";

type WriteMethod = "post" | "patch" | "delete";

export interface PlannedRequest {
  method: string;
  path: string;
  body?: unknown;
}

export interface UploadOperation {
  method: string;
  url: string;
  offset: number;
  length: number;
  headers: Record<string, string>;
}

export function placeholder(name: string): string {
  return `\${${name}}`;
}

export function isPlaceholder(value: string): boolean {
  return value.includes("${");
}

function describeAppleError(error: ApiError): string | undefined {
  const parsed = error.body ? parseJson(error.body) : undefined;
  const errors = isRecord(parsed) && Array.isArray(parsed.errors) ? parsed.errors.filter(isRecord) : [];
  if (errors.length === 0) return undefined;
  const lines = errors.map((entry) => {
    const text = typeof entry.detail === "string" ? entry.detail : String(entry.title ?? entry.code ?? "");
    const pointer = isRecord(entry.source) && typeof entry.source.pointer === "string" ? ` (${entry.source.pointer})` : "";
    return `  • ${text}${pointer}`;
  });
  return `App Store Connect refused ${error.request.replace(/^(\w+) \/v2\/organizations\/[^/]+\/app-store-connect\/proxy\/[^/]+/, "$1 ")} (${error.status}):\n${lines.join("\n")}`;
}

export class AscSession {
  readonly planned: PlannedRequest[] = [];
  readonly created: AscResource[] = [];

  constructor(
    readonly ctx: CommandContext<"required">,
    private readonly api: SuperwallApi,
    private readonly teamId: string,
    readonly dryRun: boolean,
  ) {}

  private async request(method: "get" | WriteMethod, path: string, body?: unknown): Promise<unknown> {
    this.planned.push({ method: method.toUpperCase(), path, ...(body === undefined ? {} : { body }) });
    try {
      return await apiCall(this.ctx, `${method.toUpperCase()} ${path}`, () => ascProxy(this.api, this.teamId, method, path, body));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      const described = describeAppleError(error);
      const made = this.created.map((resource) => `${resource.type} ${resource.id}`).join(", ");
      if (!described && !made) throw error;
      throw new Error([described ?? error.message, ...(made ? [`Already created: ${made}.`] : [])].join("\n"));
    }
  }

  async get(path: string): Promise<AscDocument | undefined> {
    if (isPlaceholder(path)) {
      this.planned.push({ method: "GET", path });
      return undefined;
    }
    return this.next(path);
  }

  async next(path: string): Promise<AscDocument> {
    return parseDocument(await this.request("get", path));
  }

  async list(path: string): Promise<AscDocument | undefined> {
    const first = await this.get(path);
    if (!first) return undefined;
    const pages = [first];
    let next = first.next;
    while (next) {
      const page = await this.next(next);
      pages.push(page);
      next = page.next;
    }
    return {
      data: pages.flatMap((page) => page.data),
      one: null,
      included: pages.flatMap((page) => page.included),
    };
  }

  async select(path: string): Promise<AscResource | undefined> {
    try {
      const document = await this.get(path);
      return document?.one ?? undefined;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return undefined;
      throw error;
    }
  }

  async send(method: WriteMethod, path: string, body?: unknown, ref?: string): Promise<AscResource | undefined> {
    if (this.dryRun) {
      this.planned.push({ method: method.toUpperCase(), path, ...(body === undefined ? {} : { body }) });
      return ref ? { id: placeholder(ref), type: ref, attributes: {}, relationships: {} } : undefined;
    }
    const response = await this.request(method, path, body);
    const resource = parseDocument(response).one ?? undefined;
    if (resource && method === "post") this.created.push(resource);
    return resource;
  }

  async upload(operations: readonly UploadOperation[], bytes: Uint8Array): Promise<void> {
    if (this.dryRun) {
      this.planned.push({ method: "PUT", path: "<each upload URL Apple returns>" });
      return;
    }
    for (const operation of operations) {
      this.planned.push({ method: operation.method, path: operation.url });
      const part = bytes.slice(operation.offset, operation.offset + operation.length);
      const response = await apiCall(this.ctx, "Uploading", () => fetch(operation.url, { method: operation.method, headers: operation.headers, body: part }));
      if (!response.ok) throw new Error(`Apple refused the upload to ${new URL(operation.url).host} (${response.status}).`);
    }
  }
}

export async function createAscSession(ctx: CommandContext<"required">, team: string | undefined): Promise<AscSession> {
  const api = await resolveAscOrgApi(ctx);
  const teamId = await resolveAscTeam(ctx, api, team);
  return new AscSession(ctx, api, teamId, ctx.dryRun);
}

export async function assertConfirmed(session: AscSession, yes: boolean, what: string): Promise<void> {
  const { ctx } = session;
  if (yes || session.dryRun) return;
  if (!ctx.interactive) throw new Error(`${what}\nNothing was changed. Pass --yes to go ahead.`);
  const answer = await ctx.ui.select({
    message: `${what}?`,
    options: [
      { value: "no", label: "No, stop here" },
      { value: "yes", label: "Yes, go ahead" },
    ],
    initialValue: "no",
  });
  if (answer !== "yes") throw new Error("Cancelled. Nothing was changed.");
}
