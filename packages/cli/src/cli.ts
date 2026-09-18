import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import pc from "picocolors";
import { CHANNEL, VERSION } from "@/environment";
import { writeJson } from "@/output";
import { registerAccountCommands } from "@/cli/account";
import { printHelp } from "@/cli/help";
import { registerPaywallCommands } from "@/cli/paywalls";
import { registerPlatformCommands } from "@/cli/platform";
import { registerResourceCommands } from "@/cli/resources";
import { registerWorkflowCommands } from "@/cli/workflow";

export async function run(): Promise<void> {
  const args = hideBin(process.argv);
  if (
    args.length === 0 ||
    args[0] === "help" ||
    ((args[0] === "-h" || args[0] === "--help") && args.length === 1)
  ) {
    printHelp();
    return;
  }

  let cli = yargs(args)
    .scriptName("superwall")
    .usage("Superwall CLI\n\n$0 [command]")
    .option("interactive", {
      type: "boolean",
      default: true,
      hidden: true,
      describe: "Allow prompts (use --no-interactive for automation)",
    })
    .option("json", {
      type: "boolean",
      default: false,
      describe: "Machine-readable output",
    })
    
  cli = registerWorkflowCommands(cli);
  cli = registerAccountCommands(cli);
  cli = registerPlatformCommands(cli);
  cli = registerResourceCommands(cli);
  if (CHANNEL() === "next") cli = registerPaywallCommands(cli);

  await cli
    .command(
      "$0",
      false,
      (y) => y,
      () => printHelp(),
    )
    .version(VERSION)
    .alias("v", "version")
    .help()
    .alias("h", "help")
    .recommendCommands()
    .showHelpOnFail(false)
    .fail((msg, err) => {
      if (err) throw err;
      const friendly = msg
        .replace(/^Unknown arguments?:/, "Unknown command:")
        .replace(/^Not enough non-option arguments.*$/, "Missing a required argument.");
      if (args.includes("--json")) {
        writeJson(process.stdout, {
          error: { code: "invalid_arguments", message: friendly },
        });
      } else {
        process.stderr.write(
          `${pc.red("✗")} ${friendly}\n\nRun ${pc.bold("superwall --help")} for usage.\n`,
        );
      }
      process.exit(1);
    })
    .strict()
    .parseAsync();
}
