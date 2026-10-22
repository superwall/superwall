import type { CommandContext } from "@/program/command";
import { pickOrganization } from "@/core/account/scope";
import type { SuperwallApi } from "@/core/api/client";
import { parseParams } from "@/core/api/params";
import { apiCall } from "@/ui/spinner";
import { ascProxy, listAscConfigs } from "./client";
import { formatReplacement, selectReplacement } from "./replaced";
import { buildAscBody, lookupAscOp, validateAscBody } from "./schema";
import {
  type AscIndex,
  downloadAscIndex,
  findCachedIndex,
  indexIsStale,
  refreshInBackground,
  writeCachedIndex,
} from "./spec";

type AscVerb = "get" | "post" | "patch" | "delete";

export async function ensureAscIndex(ctx: CommandContext): Promise<void> {
  const cached: AscIndex | undefined = findCachedIndex();
  if (!cached) {
    const index = await apiCall(ctx, "Fetching App Store Connect schema", () => downloadAscIndex());
    writeCachedIndex(index);
    return;
  }
  if (indexIsStale(cached)) refreshInBackground();
}

export async function resolveAscOrgApi(ctx: CommandContext<"required">): Promise<SuperwallApi> {
  return ctx.api.forOrg(await pickOrganization(ctx, ctx.api));
}

export async function resolveAscTeam(ctx: CommandContext, api: SuperwallApi, team: string | undefined): Promise<string> {
  if (team) return team;
  const configs = await apiCall(ctx, "Finding App Store Connect", () => listAscConfigs(api));
  const [first] = configs;
  if (!first) {
    throw new Error("App Store Connect isn't connected. Run `superwall asc keys create --help`.");
  }
  if (configs.length > 1) {
    const teams = configs.map((c) => String(c.team_id ?? c.id ?? "")).join(", ");
    throw new Error(`Multiple App Store Connect teams (${teams}). Pass --team <id>.`);
  }
  return String(first.team_id ?? first.id ?? "");
}

export async function sendAscRequest(
  ctx: CommandContext<"required">,
  verb: AscVerb,
  path: string,
  options: { data: string[]; team?: string; force: boolean },
): Promise<unknown> {
  const api = await resolveAscOrgApi(ctx);
  if (!path.startsWith("/")) throw new Error(`Path must start with "/", e.g. /v1/apps`);
  const replaced = selectReplacement(verb, path);
  if (replaced) ctx.ui.warn(formatReplacement(replaced));
  let body = parseParams(options.data);

  if (verb === "post" || verb === "patch") {
    await ensureAscIndex(ctx);
    const found = lookupAscOp(verb, path);
    if (found) {
      body = buildAscBody(found.op, verb, path, body);
      const problems = validateAscBody(found.op, verb, body);
      if (problems.length && !options.force)
        throw new Error(
          `Invalid ${verb.toUpperCase()} ${path} body:\n` +
            problems.map((p) => `  • ${p}`).join("\n") +
            `\nFix and retry, run \`superwall asc docs ${path} ${verb}\`, or pass --force to send as-is.`,
        );
    }
  }

  const teamId = await resolveAscTeam(ctx, api, options.team);
  return apiCall(ctx, `${verb.toUpperCase()} ${path}`, () => ascProxy(api, teamId, verb, path, body));
}
