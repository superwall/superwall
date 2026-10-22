import { performLoginWithUi } from "@/commands/workflow/integrate/app";
import { API_HOST, ENV_API_KEY } from "@/environment";
import { createSuperwallApi } from "@/core/api/client";
import type { SuperwallApi } from "@/core/api/client";
import { loadSession } from "@/core/auth/storage";
import { ui } from "@/ui";
import { apiKeyFromEnv } from "@/environment";

export class LoginRequiredError extends Error {
  constructor() {
    super(
      "Pushing paywalls needs a Superwall account.\n" +
        "  Interactively: run `superwall login`.\n" +
        "  In an agent: run `superwall login`, approve the link it prints, then `superwall login --poll`.\n" +
        `  In CI: set ${ENV_API_KEY} to an org API key (sk_…).`,
    );
    this.name = "LoginRequiredError";
  }
}

export async function requireApi(interactive: boolean): Promise<SuperwallApi> {
  const apiKey = apiKeyFromEnv();
  if (apiKey) {
    return createSuperwallApi({
      authMethod: "api_key",
      apiKey,
      host: process.env.SUPERWALL_API_HOST ?? API_HOST(),
      createdAt: new Date().toISOString(),
    });
  }

  const session = loadSession();
  if (session) return createSuperwallApi(session);

  if (!interactive) throw new LoginRequiredError();

  ui.info("You're not signed in to Superwall yet — let's fix that.");
  const signedIn = await performLoginWithUi();
  if (!signedIn) throw new LoginRequiredError();
  return createSuperwallApi(signedIn);
}
