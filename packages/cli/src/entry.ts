import { run, type RunOptions } from "@/cli";
import { flushTelemetry } from "@/core/telemetry";
import { flushUpdateCheck } from "@/core/update";

export type { RunOptions } from "@/cli";

/**
 * The CLI's programmatic entrypoint: the paywall framework's `superwall` bin
 * calls this, passing its own commands (dev, publish, …) so one shell serves
 * both the management CLI and the framework.
 */
export async function main(options: RunOptions = {}): Promise<void> {
  try {
    await run(options);
  } finally {
    await Promise.all([flushTelemetry(), flushUpdateCheck()]);
  }
}
