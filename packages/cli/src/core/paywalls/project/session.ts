import { createSuperwallApi } from "@/core/api/client";
import type { SuperwallApi } from "@/core/api/client";
import { readSession, type Session } from "@/core/account/storage";
import { performLoginWithUi } from "@/core/workflows/login";
import { API_HOST, ENV_API_KEY, apiKeyFromEnv } from "@/environment";
import { ui } from "@/ui";

export class LoginRequiredError extends Error {
  constructor() {
    super(
      "Pushing paywalls needs a Superwall account.\n" +
        "  Interactively: run `superwall login`.\n" +
        `  In CI or an agent: set ${ENV_API_KEY} to an org API key (sk_…).`,
    );
    this.name = "LoginRequiredError";
  }
}

export async function requireApi(
  interactive: boolean,
  login: () => Promise<Session | null> = performLoginWithUi,
): Promise<SuperwallApi> {
  const apiKey = apiKeyFromEnv();
  if (apiKey) {
    return createSuperwallApi({
      authMethod: "api_key",
      apiKey,
      host: process.env.SUPERWALL_API_HOST ?? API_HOST(),
      createdAt: new Date().toISOString(),
    });
  }

  const session = readSession();
  if (session) return createSuperwallApi(session);

  if (!interactive) throw new LoginRequiredError();

  ui.info("You're not signed in to Superwall yet — let's fix that.");
  const signedIn = await login();
  if (!signedIn) throw new LoginRequiredError();
  return createSuperwallApi(signedIn);
}
