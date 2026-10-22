import { installTerminal } from "@/hosts/terminal";
import { run } from "@/program/run";
import { flushTelemetry } from "@/core/support/telemetry";
import { flushUpdateCheck } from "@/core/support/upgrade";

export async function main(): Promise<void> {
  installTerminal();
  try {
    await run();
  } finally {
    await Promise.all([flushTelemetry(), flushUpdateCheck()]);
  }
}
