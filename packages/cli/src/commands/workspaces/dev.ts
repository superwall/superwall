import { app } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "workspaces dev",
  summary: "Run a workspace on localhost against your real data, read-only",
  details:
    "Bundles the workspace the way the builder does and runs it in workerd. A local page plays the dashboard: it mounts pages and widgets, sends them context and theme over the bridge, and runs metrics and readouts. API calls go out with a read-only token as you; writes and outside hosts are refused. Every change rebuilds it.",
  args: {
    dir: { describe: "The workspace (default: cwd)" },
  },
  flags: {
    port: { type: "number", alias: "p", default: 8787, describe: "Port for the dev page; the frame takes the next one" },
    org: { type: "string", value: "id", describe: "The organization in the context" },
    app: { ...app, describe: "The app in the context: an id, a name or a dashboard link" },
    campaign: { type: "string", value: "id", describe: "The campaign in the context" },
    audience: { type: "string", value: "id", describe: "The audience in the context" },
    variant: { type: "list", value: "id", describe: "A variant in the context; repeat for several" },
    user: { type: "string", value: "id", describe: "The app user in the context" },
    alias: { type: "list", value: "id", describe: "An alias of that user; repeat for several" },
    environment: { type: "string", choices: ["PRODUCTION", "SANDBOX"], describe: "The environment in the context" },
    from: { type: "string", value: "iso", describe: "Start of the date range in the context" },
    to: { type: "string", value: "iso", describe: "End of the date range in the context" },
    context: { type: "string", value: "json", describe: "The whole context as JSON, for a slot this CLI doesn't know" },
  },
  examples: [
    ["workspaces dev --org 1234", "Serve this workspace for one organization"],
    ["workspaces dev --app 5678 --user alice", "Fill in the app and the user a panel receives"],
  ],
  auth: "required",
  json: false,
  prompts: true,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runWorkspaceDev } = await import("@/core/workspaces/dev/run");
    await runWorkspaceDev(ctx, { dir: args.dir, ...flags });
  },
});
