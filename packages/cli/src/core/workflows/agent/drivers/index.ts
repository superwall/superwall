import { claudeDriver } from "./claude";
import { codexDriver } from "./codex";
import { superwallDriver } from "./superwall";
import type { AgentDriver, DriverInfo } from "./types";

export type * from "./types";

interface DetectedDriver {
  driver: AgentDriver;
  info: DriverInfo;
}

export async function detectDrivers(): Promise<DetectedDriver[]> {
  const results = await Promise.all(
    [claudeDriver, codexDriver, superwallDriver].map(async (driver) => {
      const info = await driver.detect();
      return info ? { driver, info } : null;
    }),
  );
  return results.filter((r): r is DetectedDriver => r !== null);
}
