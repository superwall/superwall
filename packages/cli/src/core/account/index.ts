import type { Arguments } from "yargs";
import type { Renderer } from "@/ui";
import { apiKeyFromEnv } from "@/util/env";
import type { ExistingIntegration } from "@/core/project/existing";

export interface AccountResult {
  apiKey: string;
}

export async function resolveAccount(opts: {
  existing: ExistingIntegration;
  argv: Arguments;
  interactive: boolean;
  ui: Renderer;
}): Promise<AccountResult | null> {
  const projectKey = opts.existing.apiKey;
  const flagKey = (opts.argv.apiKey as string | undefined) ?? apiKeyFromEnv();

  if (projectKey) {
    if (!opts.interactive || flagKey === projectKey) {
      return { apiKey: projectKey };
    }
    const use = await opts.ui.confirm({
      message: `This project already has a Superwall key (${projectKey}). Use this app?`,
    });
    if (use === null) return null;
    if (use) return { apiKey: projectKey };
  }

  if (flagKey) return { apiKey: flagKey };

  throw new Error(
    opts.interactive
      ? "Couldn't connect your app - re-run and complete the browser login."
      : "No public API key found. Pass --api-key or set SUPERWALL_API_KEY.",
  );
}
