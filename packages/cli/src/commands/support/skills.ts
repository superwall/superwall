import { dryRun, yes } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "skills",
  summary: "Install or update the Superwall agent skills for your coding agents",
  flags: {
    skill: { type: "list", value: "name", describe: "Install only these skills, by name (default: all)" },
    force: { type: "boolean", describe: "Reinstall even when the skills are up to date" },
    yes: { ...yes, describe: "Install every skill without asking" },
    dryRun: { ...dryRun, describe: "Print the install command; install nothing", hidden: true },
  },
  examples: [
    ["skills", "Pick skills and install them for every agent on this machine"],
    ["skills --skill superwall --force", "Reinstall one skill"],
  ],
  auth: "none",
  json: false,
  prompts: true,
  mcp: false,
  async run(ctx, input) {
    const { runSkills } = await import("@/core/support/skills");
    return runSkills(ctx, input);
  },
});
