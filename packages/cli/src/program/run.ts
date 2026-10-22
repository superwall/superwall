import pc from "picocolors";
import { hideBin } from "yargs/helpers";
import { renderCommand, renderRoot, renderTopic } from "@/program/help";
import { resolveLine, type Resolution } from "@/program/parse";
import { UsageError } from "@/program/command";
import { listGroups } from "@/commands/registry";
import { CHANNEL, VERSION } from "@/environment";
import { writeJson } from "@/program/output";

export async function run(): Promise<void> {
  const args = hideBin(process.argv);
  const [first] = args;
  if (first === "-v" || first === "--version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (first === undefined || first === "help" || ((first === "-h" || first === "--help") && args.length === 1)) {
    process.stdout.write(renderRoot(listGroups(), CHANNEL() === "next" ? " · next channel" : ""));
    return;
  }

  let resolution: Resolution;
  try {
    resolution = resolveLine(args, listGroups());
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    fail(error, args, "invalid_arguments");
    return;
  }
  if (resolution.kind === "none") {
    fail(new UsageError(`Unknown command: ${args.filter((arg) => !arg.startsWith("-")).join(" ")}`), args, "invalid_arguments");
    return;
  }
  await perform(resolution);
}

async function perform(resolution: Exclude<Resolution, { kind: "none" }>): Promise<void> {
  if (resolution.kind === "topic") {
    process.stdout.write(renderTopic(resolution.topic, resolution.group));
    return;
  }
  if (resolution.kind === "help") {
    const { command } = resolution;
    process.stdout.write(command.kind === "catalog" ? await command.help(resolution.words) : renderCommand(command));
    return;
  }
  await resolution.command.execute(resolution.input);
}

function fail(error: UsageError, args: readonly string[], code: string): void {
  if (args.includes("--json")) {
    writeJson(process.stdout, { error: { code, message: error.message } });
  } else {
    const help = error.command ? `superwall ${error.command} --help` : "superwall --help";
    process.stderr.write(`${pc.red("✗")} ${error.message}\n\nRun ${pc.bold(help)} for usage.\n`);
  }
  process.exitCode = 1;
}
