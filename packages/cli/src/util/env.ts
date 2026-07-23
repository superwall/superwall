import { ENV_API_KEY } from "@/constants";

export function apiKeyFromEnv(): string | undefined {
  const v = process.env[ENV_API_KEY];
  return v && v.trim() ? v.trim() : undefined;
}

export function isNonInteractive(): boolean {
  return !process.stdout.isTTY || !process.stdin.isTTY || process.env.CI === "true";
}
