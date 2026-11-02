import { dryRun, installDir, skill } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "migrate",
  summary: "Migrate from RevenueCat / Adapty / Qonversion, or rebuild a paywall or native screen as code",
  args: {
    paywall: {
      describe:
        "A dashboard paywall id: scaffold it as code (if not already) and rebuild its pages with your agent, or copy the prompt",
    },
  },
  flags: {
    installDir,
    dryRun: { ...dryRun, describe: "Plan without changes" },
    skill,
    screen: {
      type: "string",
      value: "path",
      bare: true,
      describe:
        "A SwiftUI, UIKit, Kotlin (Compose or Views), React Native or Flutter file to rebuild as a Superwall screen (no path: pick from likely candidates)",
    },
    screenshot: {
      type: "string",
      value: "path",
      describe: "A screenshot of the native screen, shown as Compare › Original in the studio",
    },
  },
  examples: [
    ["migrate", "Move this app off RevenueCat / Adapty / Qonversion"],
    ["migrate --skill", "Print the migration playbook for your own agent"],
    ["migrate 65920", "Rebuild dashboard paywall 65920 as code"],
    ["migrate --screen App/UpdateRequiredView.swift", "Rebuild a native screen as a Superwall surface"],
  ],
  auth: "optional",
  json: false,
  prompts: true,
  mcp: false,
  async run(ctx, { args, flags }) {
    const { runPaywallMigration, runProviderMigration, runScreenMigration } = await import("@/core/workflows/migrate");
    const { printPlaybook } = await import("@/core/workflows/playbook");
    if (flags.screen !== undefined) {
      return runScreenMigration(ctx, { path: flags.screen, screenshot: flags.screenshot }, flags.skill);
    }
    if (args.paywall !== undefined) return runPaywallMigration(ctx, args.paywall, flags.skill);
    if (flags.skill) return printPlaybook(ctx.installDir, "migrate");
    await runProviderMigration(ctx);
  },
});
