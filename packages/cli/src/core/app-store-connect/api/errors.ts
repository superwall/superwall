import { ApiError } from "@/core/api/client";
import { isRecord, parseJson } from "@/core/json";

export class AscRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function statusOf(error: unknown): number | undefined {
  return error instanceof ApiError || error instanceof AscRequestError ? error.status : undefined;
}

function describeEntry(entry: Record<string, unknown>): string {
  const code = typeof entry.code === "string" && entry.code ? entry.code : undefined;
  const text = typeof entry.detail === "string" && entry.detail ? entry.detail : typeof entry.title === "string" && entry.title ? entry.title : undefined;
  const source = isRecord(entry.source) ? entry.source : {};
  const where = typeof source.pointer === "string" ? source.pointer : typeof source.parameter === "string" ? source.parameter : undefined;
  const head = [code, text].filter(Boolean).join(": ");
  return `  • ${head}${where ? ` (${where})` : ""}`;
}

export function describeAppleError(error: ApiError): string | undefined {
  const parsed = error.body ? parseJson(error.body) : undefined;
  const errors = isRecord(parsed) && Array.isArray(parsed.errors) ? parsed.errors.filter(isRecord) : [];
  if (errors.length === 0) return undefined;
  const request = error.request.replace(/^(\w+) \/v2\/organizations\/[^/]+\/app-store-connect\/proxy\/[^/]+/, "$1 ");
  return `App Store Connect refused ${request} (${error.status}):\n${errors.map(describeEntry).join("\n")}`;
}

export async function withAppleErrors<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const described = describeAppleError(error);
    if (!described) throw error;
    throw new AscRequestError(described, error.status);
  }
}
