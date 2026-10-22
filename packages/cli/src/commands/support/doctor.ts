import { installDir } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "doctor",
  summary: "Check the health of your Superwall integration",
  flags: { installDir },
  examples: [
    ["doctor", "Check this app, the agents on this machine and your login"],
    ["doctor --json", "The same checks as data"],
  ],
  auth: "optional",
  json: true,
  prompts: true,
  mcp: false,
  async run(ctx) {
    const { runDoctor } = await import("@/core/support/doctor");
    return runDoctor(ctx);
  },
});
