import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "upgrade",
  summary: "Update the CLI to the latest version",
  examples: [["upgrade", "Install the latest version globally with npm"]],
  auth: "none",
  json: true,
  prompts: true,
  mcp: false,
  async run(ctx) {
    const { runUpgrade } = await import("@/core/support/upgrade");
    return runUpgrade(ctx);
  },
});
