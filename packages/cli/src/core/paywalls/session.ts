import { performLoginWithUi } from "@/commands/integrate/app";
import { API_HOST, ENV_API_KEY } from "@/constants";
import { SuperwallApi } from "@/core/api/client";
import { loadSession } from "@/core/auth/storage";
import { ui } from "@/ui";
import { apiKeyFromEnv } from "@/util/env";

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

/**
 * Resolves the API for a paywall command, signing in first when needed.
 *
 * `push` is often the first Superwall command anyone — or any agent — runs,
 * so an absent session is a step in the flow rather than a failure:
 * interactively it starts the browser login and continues; non-interactively
 * it explains both ways to authenticate.
 */
export async function requireApi(interactive: boolean): Promise<SuperwallApi> {
  const apiKey = apiKeyFromEnv();
  if (apiKey) {
    return SuperwallApi.of({
      authMethod: "api_key",
      apiKey,
      host: process.env.SUPERWALL_API_HOST ?? API_HOST,
      createdAt: new Date().toISOString(),
    });
  }

  const session = loadSession();
  if (session) return SuperwallApi.of(session);

  if (!interactive) throw new LoginRequiredError();

  ui.info("You're not signed in to Superwall yet — let's fix that.");
  const signedIn = await performLoginWithUi();
  if (!signedIn) throw new LoginRequiredError();
  return SuperwallApi.of(signedIn);
}
