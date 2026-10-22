import { dryRun, installDir, skill } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "review",
  summary: "Review an existing Superwall setup end to end",
  flags: {
    installDir,
    dryRun: { ...dryRun, hidden: true },
    skill,
    fix: { type: "boolean", describe: "Apply verified, safe fixes from the latest review" },
  },
  examples: [
    ["review", "Audit this app's Superwall setup and write a report"],
    ["review --fix", "Apply the safe fixes from the latest review"],
  ],
  auth: "optional",
  json: false,
  prompts: true,
  mcp: false,
  async run(ctx, { flags }) {
    const { runReview } = await import("@/core/workflows/integrate");
    const { printPlaybook } = await import("@/core/workflows/playbook");
    if (flags.skill) return printPlaybook(ctx.installDir, flags.fix ? "review-fix" : "review");
    await runReview(ctx, flags.fix);
  },
});
