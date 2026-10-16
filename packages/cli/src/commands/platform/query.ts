import { readFileSync } from "node:fs";
import { defineCommand, type CommandContext } from "@/command";
import { pickOrganization } from "@/commands/resource/scope";
import { apiCall } from "@/commands/api-output";

export const runQuery = defineCommand({
  name: "query",
  auth: "required",
  interaction: "none",
  output: "both",
  async run(ctx) {
    const sql = readSql(ctx);
    const params = ctx.json ? "?default_format=JSON" : "";
    if (ctx.json && /\bFORMAT\s+[A-Za-z0-9_]+\s*;?\s*$/i.test(sql)) {
      throw new Error(
        "Remove the FORMAT clause when using --json; the CLI requests ClickHouse JSON for you.",
      );
    }
    const organizationId = await pickOrganization(ctx, ctx.api);

    if (!ctx.json) ctx.ui.intro("Superwall query");
    const output = await apiCall(ctx, "Querying ClickHouse", () =>
      ctx.api.postText(
        `/v2/organizations/${encodeURIComponent(organizationId)}/query${params}`,
        sql,
      ),
    );

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
  },
});

function readSql(ctx: CommandContext): string {
  const inline = ctx.argv.sql as string | undefined;
  const file = ctx.argv.file as string | undefined;
  if (inline && file)
    throw new Error("Pass SQL as an argument, with --file, or on stdin - choose one.");

  const value = inline ?? (file ? readFileSync(file, "utf8") : readStdin());
  if (!value?.trim()) {
    throw new Error('Provide SQL: superwall query "SELECT ...", --file <query.sql>, or stdin.');
  }
  return value.trim();
}

function readStdin(): string {
  if (process.stdin.isTTY) return "";
  return readFileSync(0, "utf8");
}
