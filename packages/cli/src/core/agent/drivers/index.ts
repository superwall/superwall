import type { AgentDriver, DriverInfo } from "./types";
import { claudeDriver } from "./claude";
import { codexDriver } from "./codex";
import { superwallDriver } from "./superwall";

export * from "./types";
export { claudeDriver, codexDriver, superwallDriver };

export const ALL_DRIVERS: AgentDriver[] = [claudeDriver, codexDriver, superwallDriver];

export interface DetectedDriver {
  driver: AgentDriver;
  info: DriverInfo;
}

export async function detectDrivers(): Promise<DetectedDriver[]> {
  const results = await Promise.all(
    ALL_DRIVERS.map(async (driver) => {
      const info = await driver.detect();
      return info ? { driver, info } : null;
    }),
  );
  return results.filter((r): r is DetectedDriver => r !== null);
}
