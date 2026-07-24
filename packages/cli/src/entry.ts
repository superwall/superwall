import { run } from "@/cli";
import { flushTelemetry } from "@/core/telemetry";
import { flushUpdateCheck } from "@/core/update";

/**
 * The CLI's programmatic entrypoint: the `superwall` package's bin calls
 * this after registering tsx (which is what lets the paywall commands load
 * the project's framework TypeScript at runtime).
 */
export async function main(): Promise<void> {
  try {
    await run();
  } finally {
    await Promise.all([flushTelemetry(), flushUpdateCheck()]);
  }
}
