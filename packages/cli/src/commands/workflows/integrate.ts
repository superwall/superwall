import { dryRun, installDir, skill } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "integrate",
  summary: "Set up the SDK, placements, and dashboard in your app",
  flags: {
    installDir,
    apiKey: { type: "string", value: "key", describe: "Your app's public Superwall API key (pk_…)" },
    dryRun: { ...dryRun, hidden: true },
    skill,
    driver: {
      type: "string",
      choices: ["claude", "codex", "superwall"],
      describe: "Force a coding-agent backend (default: first detected)",
      hidden: true,
    },
  },
  examples: [
    ["integrate", "Set up Superwall in this app with your coding agent"],
    ["integrate --skill", "Print the integration playbook for your own agent"],
  ],
  auth: "optional",
  json: false,
  prompts: true,
  mcp: false,
  async run(ctx, { flags }) {
    const { runIntegrate } = await import("@/core/workflows/integrate");
    const { printPlaybook } = await import("@/core/workflows/playbook");
    if (flags.skill) return printPlaybook(ctx.installDir, "integrate");
    await runIntegrate({ ...ctx, apiKey: flags.apiKey, driver: flags.driver });
  },
});
