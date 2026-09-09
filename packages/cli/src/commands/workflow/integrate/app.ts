import { ui } from "@/ui";
import { withSpinner } from "@/ui/spinner";
import { SUPPORTED_LABEL } from "@/core/project/frameworks";
import { scanProject, type DetectedApp } from "@/core/project/scan";
import type { ExistingIntegration } from "@/core/project/existing";
import { performLogin, type ProvisionedApp } from "@/core/auth/login";
import { onboardingHooks } from "@/core/account/onboarding";
import {
  resolveAppBinding,
  resolveScopeFromKey,
  platformForIntegration,
} from "@/core/account/bind";
import { superwallApi } from "@/core/api/client";
import type { SuperwallApi } from "@/core/api/client";
import type { Scope } from "@/core/api/resources";
import { clearSession, loadSession, type Session } from "@/core/auth/storage";
import { getHostedStatus } from "@/core/agent/hosted";
import type { AgentDriver } from "@/core/agent/drivers";
import { ACTIONS, type ActionId } from "@/core/agent/actions";

export async function performLoginWithUi(
  app?: DetectedApp,
  onProvisioned?: (result: ProvisionedApp) => void,
): Promise<Session | null> {
  const spin = ui.spinner();
  const hooks = onboardingHooks(app);
  try {
    const session = await performLogin({
      onVerify: ({ url, userCode }) => {
        ui.info(`Approve this login in your browser · code \`${userCode}\`\n${url}`);
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
    ui.warn((error as Error).message);
    return null;
  }
}

/**
 * The project has an API key that matches nothing in the logged-in org - most
 * likely the wrong account. Offer to re-login, rebind, or skip; returns the
 * resolved scope when a fix works.
 */
export async function recoverUnmatchedScope(
  app: DetectedApp,
  apiKey: string,
): Promise<{ scope: Scope; bundleId?: string } | null> {
  for (;;) {
    const orgName = loadSession()?.orgName;
    const orgLabel = orgName ? `\`${orgName}\`` : "your organization";
    ui.error(
      `This project's API key (\`${apiKey}\`) doesn't match any app in ${orgLabel}. You might be logged in to the wrong account.`,
    );
    const choice = await ui.select({
      message: "How do you want to fix it?",
      options: [
        { value: "relogin", label: "Log in with a different account" },
        {
          value: "bind",
          label: `Connect this app to ${orgLabel} instead`,
          hint: "creates or picks an app and issues a new API key",
        },
        { value: "skip", label: "Skip for now" },
      ],
    });
    if (choice === null || choice === "skip") return null;

    if (choice === "relogin") {
      clearSession();
      if (!(await performLoginWithUi(app))) return null;
      const resolved = await withSpinner("Finding this app in Superwall", () =>
        resolveScopeFromKey(superwallApi(), apiKey).catch(() => null),
      );
      if (resolved) {
        ui.success(`Found \`${resolved.appName ?? app.name}\``);
        return {
          scope: {
            projectId: resolved.projectId,
            applicationId: resolved.applicationId,
            appName: resolved.appName ?? app.name,
          },
          bundleId: resolved.bundleId,
        };
      }
      continue;
    }

    try {
      const bound = await resolveAppBinding(superwallApi(), {
        platform: platformForIntegration(app.integration),
        appName: app.name,
      });
      if (!bound) continue;
      ui.note(
        `Your code still uses \`${apiKey}\`.\nReplace it with \`${bound.apiKey}\` so the app talks to ${orgLabel}.`,
        "Swap the API key",
      );
      return {
        scope: {
          projectId: bound.projectId,
          applicationId: bound.applicationId,
          appName: app.name,
        },
        bundleId: bound.app.bundle_id,
      };
    } catch (error) {
      ui.warn((error as Error).message);
    }
  }
}

export async function ensureAgentDriverReady(
  driver: AgentDriver,
  ensureLogin: () => Promise<boolean>,
  dryRun: boolean,
): Promise<boolean> {
  if (driver.id !== "superwall" || dryRun) return true;

  if (!(await ensureLogin())) {
    ui.warn(
      "Superwall Agent needs sign-in. Run `superwall login`, or install Claude Code/Codex and re-run.",
    );
    return false;
  }

  const status = await withSpinner("Checking Superwall Agent credit", () => getHostedStatus());
  if (!status) {
    ui.warn(
      "Superwall Agent needs an OAuth login. Run `superwall login` (not `--api-key`), or install Claude Code/Codex.",
    );
    return false;
  }
  if (status.exhausted) {
    ui.warn(
      "Your hosted Superwall Agent credit is exhausted. Install Claude Code/Codex or copy the prompt into your own agent.",
    );
    return false;
  }

  return true;
}

export async function pickApp(
  installDir: string,
  interactive: boolean,
): Promise<DetectedApp | null> {
  const scan = await withSpinner("Scanning your project", () => scanProject(installDir));
  if (scan.apps.length === 0) {
    if (scan.unsupported.length) {
      const webApp = scan.unsupported[0]!;
      throw new Error(
        `Detected a web app${webApp.details ? ` (\`${webApp.details}\`)` : ""}. This command supports mobile apps.`,
      );
    }
    const skipped = scan.skipped.length ? ` Skipped: ${scan.skipped.join(", ")}.` : "";
    throw new Error(`No ${SUPPORTED_LABEL} app found in this directory.${skipped}`);
  }
  if (scan.unsupported.length) {
    ui.info(
      `Also found unsupported web apps: ${scan.unsupported.map((app) => app.name).join(", ")}`,
    );
  }
  if (scan.apps.length === 1) {
    const app = scan.apps[0]!;
    ui.info(
      `Detected \`${app.framework.name}\`` +
        (app.details ? ` · \`${app.details}\`` : "") +
        (app.relPath !== "." ? `  (${app.relPath})` : ""),
    );
    return app;
  }
  if (!interactive) {
    throw new Error("Multiple apps found. Pass --install-dir for the app you want to change.");
  }
  const choice = await ui.select({
    message: scan.isMonorepo ? "Found multiple apps - which one?" : "Which app?",
    options: scan.apps.map((app) => ({
      value: app.path,
      label: `${app.name} · ${app.framework.name}`,
      hint: app.relPath === "." ? undefined : app.relPath,
    })),
    initialValue: scan.apps[0]!.path,
  });
  if (choice === null) return null;
  return scan.apps.find((app) => app.path === choice) ?? scan.apps[0]!;
}

export async function chooseAction(
  forced: ActionId | undefined,
  existing: ExistingIntegration,
  app: DetectedApp,
  interactive: boolean,
): Promise<ActionId | null> {
  if (forced) return forced;
  if (!interactive) return "integrate";

  if (!existing.sdkInstalled) {
    const confirmed = await ui.confirm({
      message: `Integrate Superwall into \`${app.name}\`?`,
    });
    if (confirmed === null) {
      ui.warn("Cancelled.");
      return null;
    }
    if (!confirmed) {
      ui.outro("No problem - run `superwall integrate` again anytime.");
      return null;
    }
    return "integrate";
  }

  const available = ACTIONS.filter((action) => {
    if (action.id === "integrate") return false;
    if (action.requiresOrgKey && !process.env.SUPERWALL_API_KEY) return false;
    return true;
  });
  const selection = await ui.select({
    message: "What do you want to do?",
    options: available.map((action) => ({
      value: action.id,
      label: action.title,
      hint: action.hint,
    })),
    initialValue: "review",
  });
  return selection as ActionId | null;
}

export async function stage(label: string, work: () => Promise<void> | void): Promise<void> {
  ui.step(label);
  // Let Ink paint the step header before the body's spinner starts.
  await new Promise((resolve) => setTimeout(resolve, 40));
  await work();
}
