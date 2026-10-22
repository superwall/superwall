import type { CommandContext } from "@/program/command";
import { ApiError, withQuery, type SuperwallApi } from "@/core/api/client";
import { parseParams } from "@/core/api/params";
import { findOperations, resolveApiIndex } from "@/core/api/reference";
import { apiCall } from "@/ui/spinner";

type ApiVerb = "get" | "post" | "patch" | "delete";

export async function runApiRequest(
  ctx: CommandContext,
  api: SuperwallApi,
  request: { verb: ApiVerb; path: string; data: string[] },
): Promise<void> {
  const { verb, path } = request;
  if (!path.startsWith("/")) throw new Error(`Path must start with "/", e.g. /v2/products`);
  const params = parseParams(request.data);

  const res = await apiCall(ctx, `${verb.toUpperCase()} ${path}`, () => {
    switch (verb) {
      case "get":
        return api.get(withQuery(path, params));
      case "delete":
        return api.del(withQuery(path, params));
      case "post":
        return api.post(path, params);
      case "patch":
        return api.patch(path, params);
    }
  }).catch(async (error: unknown) => {
    if (!(error instanceof ApiError) || error.status >= 500 || error.status === 401) throw error;
    throw new Error(`${error.message}\n${await resolveReferenceHint(verb, path)}`, { cause: error });
  });
  ctx.output.data(res ?? { ok: true });
}

export async function resolveReferenceHint(verb: string, path: string): Promise<string> {
  const index = await resolveApiIndex().catch(() => undefined);
  if (!index) return "The API reference: superwall api docs <words>";
  const ops = findOperations(index, path);
  const same = ops.find((op) => op.method === verb.toUpperCase());
  if (same) return `Its parameters and body: superwall api docs ${same.path} ${verb}`;
  const [first] = ops;
  if (first) {
    return `${path} takes ${ops.map((op) => op.method).join(", ")}, not ${verb.toUpperCase()}: superwall api docs ${first.path}`;
  }
  const words = path.split(/[/?]/).filter((part) => part && !/^v\d+$/.test(part) && !/^\d+$/.test(part));
  return `No endpoint has this path. Search the reference: superwall api docs ${words.slice(-2).join(" ")}`;
}
