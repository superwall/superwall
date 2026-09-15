import type { Argv } from "yargs";
import { apiKeyOption, dryRunOption, installDirOption, skillOption } from "./options";

export const registerWorkflowCommands = <T>(cli: Argv<T>): Argv<T> =>
  cli
  .command(
    "integrate",
    "Set up the SDK, placements, and dashboard in your app",
    (y) =>
      y.options({
        ...installDirOption,
        ...apiKeyOption,
        ...dryRunOption,
        ...skillOption,
        driver: {
          type: "string",
          choices: ["claude", "codex", "superwall"],
          describe: "Force a coding-agent backend (default: first detected)",
          hidden: true,
        },
      }),
    (argv) => {
      if (argv.skill)
        return import("@/commands/workflow/print-skill").then((m) => m.runPrintSkill("integrate")(argv));
      return import("@/commands/workflow/integrate").then((m) => m.runIntegrate(argv));
    },
  )
  .command(
    "review",
    "Review an existing Superwall setup end to end",
    (y) =>
      y.options({
        ...installDirOption,
        ...dryRunOption,
        ...skillOption,
        fix: {
          type: "boolean",
          describe: "Apply verified, safe fixes from the latest review",
        },
      }),
    (argv) => {
      const id = argv.fix ? "review-fix" : "review";
      if (argv.skill)
        return import("@/commands/workflow/print-skill").then((m) => m.runPrintSkill(id)(argv));
      return import("@/commands/workflow/integrate").then((m) => m.runActionCommand(id)(argv));
    },
  )
  .command(
    "migrate [paywall]",
    "Migrate from RevenueCat / Adapty / Qonversion, or rebuild a dashboard paywall as code",
    (y) =>
      y
        .positional("paywall", {
          type: "string",
          describe:
            "A dashboard paywall id: scaffold it as code (if not already) and rebuild its pages with your agent, or copy the prompt",
        })
        .options({
          ...installDirOption,
          "dry-run": { type: "boolean", describe: "Plan without changes" },
          ...skillOption,
        })
        .example("$0 migrate", "Move this app off RevenueCat / Adapty / Qonversion")
        .example("$0 migrate 65920", "Rebuild dashboard paywall 65920 as code"),
    (argv) => {
      if (argv.skill && argv.paywall === undefined)
        return import("@/commands/workflow/print-skill").then((m) => m.runPrintSkill("migrate")(argv));
      return import("@/commands/workflow/migrate").then((m) => m.runMigrate(argv));
    },
  );
