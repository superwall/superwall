import type { CommandContext } from "@/program/command";
import { readInput } from "@/program/host";
import { pickOrganization } from "@/core/account/scope";
import { findIntegrations, REVENUE_INTEGRATIONS } from "@/core/api/integrations";
import { appNotFound, findApplication } from "@/core/api/lookup";
import { apiCall } from "@/ui/spinner";

function parseUserParams(pairs: string[]): [string, string][] {
  return pairs.map((text) => {
    const eq = text.indexOf("=");
    if (eq < 1) throw new Error(`Invalid --param "${text}" - expected name=value.`);
    return [text.slice(0, eq), text.slice(eq + 1)];
  });
}

async function appParams(ctx: CommandContext<"required">, ref: string): Promise<[string, string][]> {
  const found = await findApplication(ctx.api, ref);
  if (!found) throw appNotFound(ref);
  const id = String(found.app.id);
  const overview = await apiCall(ctx, "Loading its revenue provider", () => {
    return findIntegrations(ctx.api, id).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Couldn't read the revenue provider of \`${found.app.name ?? id}\`, so revenue can't be counted the way the dashboard does: ${reason}`, { cause: error });
    });
  });
  const provider = overview.revenue_provider ?? null;
  const integrations = REVENUE_INTEGRATIONS[provider ?? "none"];
  if (!ctx.json) {
    const counted = provider ? `counts revenue from ${provider}` : "has no revenue provider, so every source counts";
    ctx.ui.info(`\`${found.app.name ?? id}\` ${counted}: {revenue_integrations} is ${integrations.join(", ")}`);
  }
  return [
    ["app", id],
    ["revenue_provider", provider ?? ""],
    ["revenue_integrations", `[${integrations.map((name) => `'${name}'`).join(",")}]`],
  ];
}

function readSql(inline: string | undefined, file: string | undefined): string {
  if (inline && file) throw new Error("Pass SQL as an argument, with --file, or on stdin - choose one.");
  const value = inline ?? (file ? readInput(file) : readStdin());
  if (!value?.trim()) {
    throw new Error('Provide SQL: superwall query "SELECT ...", --file <query.sql>, or stdin.');
  }
  return value.trim();
}

function readStdin(): string {
  if (process.stdin?.isTTY !== false) return "";
  return readInput("-");
}

interface QueryInput {
  args: { sql: string | undefined; };
  flags: { file: string | undefined; param: string[]; app: string | undefined; };
}

export async function runQuery(ctx: CommandContext<"required">, { args, flags }: QueryInput): Promise<void> {
  const sql = readSql(args.sql, flags.file);
  if (ctx.json && /\bFORMAT\s+[A-Za-z0-9_]+\s*;?\s*$/i.test(sql)) {
    throw new Error(
      "Remove the FORMAT clause when using --json; the CLI requests ClickHouse JSON for you.",
    );
  }
  const organizationId = await pickOrganization(ctx, ctx.api);
  const params = new URLSearchParams(ctx.json ? { default_format: "JSON" } : {});
  for (const [name, value] of parseUserParams(flags.param)) params.set(`param_${name}`, value);

  if (!ctx.json) ctx.ui.intro("Superwall query");
  if (ctx.target.app) {
    for (const [name, value] of await appParams(ctx, ctx.target.app)) params.set(`param_${name}`, value);
  }
  const query = params.toString();
  const output = await apiCall(ctx, "Querying ClickHouse", () => {
    return ctx.api.postText(
      `/v2/organizations/${encodeURIComponent(organizationId)}/query${query ? `?${query}` : ""}`,
      sql,
    );
  });

  if (ctx.json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new Error(
        "ClickHouse did not return valid JSON. Remove any FORMAT clause and try again.",
      );
    }
    ctx.output.data(parsed);
    return;
  }

  ctx.output.text(output.trimEnd());
}
