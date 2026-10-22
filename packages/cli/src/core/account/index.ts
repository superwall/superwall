import type { ExistingIntegration } from "@/core/codebase/existing";
import type { Renderer } from "@/ui";

interface AccountResult {
  apiKey: string;
}

export async function resolveAccount(opts: {
  existing: ExistingIntegration;
  apiKey: string | undefined;
  interactive: boolean;
  ui: Renderer;
}): Promise<AccountResult | null> {
  const projectKey = opts.existing.apiKey;
  const flagKey = opts.apiKey;

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
      : "No public API key found. Pass --api-key.",
  );
}
