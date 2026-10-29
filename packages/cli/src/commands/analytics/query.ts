import { app } from "@/program/flags";
import { defineCommand } from "@/program/command";
import { runQuery } from "@/core/analytics/query";

export const command = defineCommand({
  name: "query",
  summary: "SQL against your analytics in ClickHouse",
  details: `With --app the query gets three parameters, used in SQL as {name:Type}:
  {app:UInt64}                         the app's id
  {revenue_provider:String}            open_revenue, revenue_cat, or empty when none is chosen
  {revenue_integrations:Array(String)} the integrations its revenue figures count
Many apps receive revenue from both the store and RevenueCat, so the same purchase can
arrive twice. Count revenue the way the dashboard does:
  WHERE applicationId = {app:UInt64}
    AND (integration IN {revenue_integrations:Array(String)} OR source = 'sdk')
    AND NOT (coalesce(integration, '') = 'revenue_cat' AND store = 'STRIPE')
--param name=value adds any other parameter.

The backend forces SQL to readonly=1. Before executing SQL it may provision a ClickHouse user and role, persist credentials and reconcile access policies for the organization. SQL read-only mode does not prevent these setup changes.`,
  args: {
    sql: { describe: "SQL query (or pass it with --file / stdin)", mcp: "required" },
  },
  flags: {
    file: { type: "string", value: "path", describe: "Read SQL from a .sql file", mcp: false },
    param: {
      type: "list",
      value: "name=value",
      describe: "A query parameter, name=value, used in SQL as {name:Type} (repeatable)",
    },
    app: {
      ...app,
      describe: "The app it's about: picks its account and fills {app}, {revenue_provider} and {revenue_integrations}",
    },
  },
  examples: [
    ['query "SHOW TABLES FROM open_revenue"', "What there is to query"],
    ["query --file revenue.sql --app <app> --json", "A saved query, scoped to one app"],
  ],
  auth: "required",
  json: true,
  prompts: false,
  mcp: "destructive",
  run(ctx, input) {
    return runQuery(ctx, input);
  },
});
