import { app } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "workspaces try",
  summary: "Upload a draft and run an entrypoint on the real runtime",
  details:
    "Nothing is saved: the draft runs as you, read-only and with no outside hosts, and only you can reach it for a day. A metric prints its series. A page, panel, tab, card or action opens in the dashboard. Readouts run with workspaces dev until the runtime takes them.",
  args: {
    entrypoint: { describe: "The entrypoint id from superwall.json", required: true },
  },
  flags: {
    dir: { type: "string", value: "path", describe: "The workspace (default: cwd)" },
    app: { ...app, describe: "The app to run it for: an id, a name or a dashboard link" },
    org: { type: "string", value: "id", describe: "The organization, when the app alone doesn't find it" },
    from: { type: "string", value: "iso", describe: "Start of the window (default: --days ago)" },
    to: { type: "string", value: "iso", describe: "End of the window (default: now)" },
    days: { type: "number", default: 30, describe: "How far back the window starts" },
    interval: { type: "string", choices: ["hour", "day", "week", "month"], default: "day", describe: "Bucket size" },
    breakdown: { type: "string", value: "key", describe: "One of the metric's declared breakdowns" },
    filter: { type: "list", value: "key=value", describe: "One of the metric's declared filter values; repeat for several" },
    points: { type: "boolean", describe: "Print every point, not just each series' summary" },
    campaign: { type: "string", value: "id", describe: "For a frame: the campaign in its context" },
    user: { type: "string", value: "id", describe: "For a frame: the app user in its context" },
    environment: { type: "string", choices: ["PRODUCTION", "SANDBOX"], describe: "For a frame: the environment in its context" },
    open: { type: "boolean", default: true, describe: "Open a frame in your browser at a terminal (--no-open to only print the link)" },
  },
  examples: [
    ["workspaces try transactions --app 5678", "Run a metric for one app over the last 30 days"],
    ["workspaces try transactions --app 5678 --breakdown store --filter store=APP_STORE", "Split and filter it"],
    ["workspaces try home --org 1234", "Open a page in the dashboard"],
  ],
  auth: "required",
  json: true,
  prompts: true,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runWorkspaceTry } = await import("@/core/workspaces/try");
    await runWorkspaceTry(ctx, { entrypoint: args.entrypoint, ...flags });
  },
});
