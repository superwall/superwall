import { onboardingHooks } from "@/core/account/onboarding";
import { BROWSER_UNAVAILABLE } from "@/core/account/browser";
import { performLogin, type ProvisionedApp } from "@/core/account/login";
import type { Session } from "@/core/account/storage";
import type { DetectedApp } from "@/core/codebase/scan";
import { ui } from "@/ui";

export async function performLoginWithUi(
  app?: DetectedApp,
  onProvisioned?: (result: ProvisionedApp) => void,
): Promise<Session | null> {
  const spin = ui.spinner();
  const hooks = onboardingHooks(app);
  try {
    const session = await performLogin({
      onVerify: ({ url, userCode, browserOpened }) => {
        ui.info(`Approve this login in your browser · code \`${userCode}\`\n${url}`);
        if (!browserOpened) ui.warn(BROWSER_UNAVAILABLE);
        spin.start("Waiting for you to approve in the browser");
      },
      onStatus: (message) => spin.message(message),
      onOnboard: async () => {
        const setup = await hooks.onOnboard();
        if (setup) spin.start("Creating your account");
        return setup;
      },
      onProvisioned: (result) => {
        hooks.onProvisioned(result);
        onProvisioned?.(result);
      },
    });
    spin.stop(`Logged in as \`${session.userEmail ?? "you"}\``);
    return session;
  } catch (error) {
    spin.stop("Login failed");
    ui.warn(error instanceof Error ? error.message : String(error));
    return null;
  }
}

interface LoginGate {
  ensure: () => Promise<boolean>;
  provisioned: () => ProvisionedApp | null;
}

export function createLoginGate(
  app: DetectedApp,
  options: { session: Session | null; interactive: boolean; dryRun: boolean },
): LoginGate {
  let session = options.session;
  let provisioned: ProvisionedApp | null = null;
  return {
    ensure: async () => {
      if (session) return true;
      if (!options.interactive || options.dryRun) return false;
      const signedIn = await performLoginWithUi(app, (result) => {
        provisioned = result;
      });
      if (!signedIn) return false;
      session = signedIn;
      return true;
    },
    provisioned: () => provisioned,
  };
}
