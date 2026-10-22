import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { superwallApi } from "@/core/api/client";
import { installTerminal } from "@/hosts/terminal";

interface Case {
  input: Record<string, unknown>;
  dryRun?: boolean;
  ok?: boolean;
}

interface Outcome {
  ok: boolean;
  data: unknown;
}

const [casesFile, reportFile, only] = process.argv.slice(2);
if (!casesFile || !reportFile) {
  console.error("usage: tsx scripts/mcp-parity.ts <cases.json> <report.json> [tool-prefix]");
  process.exit(2);
}
const cases: Record<string, Case[]> = JSON.parse(readFileSync(casesFile, "utf8"));

installTerminal();
const api = superwallApi();
const { listTools } = await import("@/tools");
const tools = new Map((await listTools()).map((tool) => [tool.name, tool]));

function runCli(argv: string[]): Outcome {
  const result = spawnSync("bun", ["--no-env-file", "bin.ts", ...argv, "--json", "--no-interactive"], {
    encoding: "utf8",
    env: process.env,
    timeout: 180_000,
    maxBuffer: 512 * 1024 * 1024,
  });
  const text = result.stdout.trim();
  let data: unknown;
  try {
    data = text === "" ? null : JSON.parse(text);
  } catch {
    data = { unparsed: text.slice(0, 500), stderr: result.stderr.slice(0, 500) };
  }
  return { ok: result.status === 0, data };
}

const VOLATILE = new Set(["elapsed"]);

const bootstrap = await tools.get("bootstrap")?.run({}, api);
const memberOrgs = new Set(
  ((bootstrap?.data as { organizations?: { id: string; member: boolean }[] } | null)?.organizations ?? [])
    .filter((org) => org.member)
    .map((org) => String(org.id)),
);

const opened = (value: unknown) => {
  if (typeof value !== "object" || value === null) return false;
  const row = value as { member?: unknown; organizationId?: unknown; organization_id?: unknown };
  if (row.member === false) return true;
  const org = row.organizationId ?? row.organization_id;
  return org !== undefined && memberOrgs.size > 0 && !memberOrgs.has(String(org));
};

const REQUEST_ID = /"id"\s*:\s*"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/gi;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((item) => !opened(item)).map(stable);
  if (typeof value === "string") return value.replace(REQUEST_ID, '"id": "<request>"');
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !VOLATILE.has(key)).map(([key, inner]) => [key, stable(inner)]));
}

const report: Record<string, unknown>[] = [];
for (const [name, list] of Object.entries(cases)) {
  if (only && !name.startsWith(only)) continue;
  const tool = tools.get(name);
  if (!tool) {
    report.push({ tool: name, status: "unknown tool" });
    continue;
  }
  for (const { input, dryRun, ok } of list) {
    const sent = dryRun ? { ...input, dry_run: true } : input;
    const argv = tool.cli(sent);
    const cli = runCli(argv);
    let mcp: Outcome;
    try {
      mcp = await tool.run(sent, api);
    } catch (error) {
      mcp = { ok: false, data: { threw: error instanceof Error ? error.message : String(error) } };
    }
    const same = cli.ok === mcp.ok && isDeepStrictEqual(stable(cli.data), stable(mcp.data));
    const expected = ok === undefined || cli.ok === ok;
    report.push({ tool: name, status: !same ? "different" : expected ? "same" : "unexpected", cli: argv.join(" "), input: sent, cliOutcome: cli, mcpOutcome: mcp });
    const mark = !same ? "✗" : expected ? "✓" : "!";
    console.log(`${mark} ${name} ${cli.ok ? "ok" : "error"}${same ? "" : ` / mcp ${mcp.ok ? "ok" : "error"}`}${expected ? "" : ` (expected ${ok ? "ok" : "error"})`}`);
  }
}
writeFileSync(reportFile, JSON.stringify(report, null, 2));
const different = report.filter((entry) => entry.status !== "same");
console.log(`\n${report.length - different.length}/${report.length} identical`);
if (different.length > 0) process.exitCode = 1;
