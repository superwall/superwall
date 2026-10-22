import { resolveAppBinding, resolveScopeFromKey, platformForIntegration } from "@/core/account/bind";
import type { AgentDriver } from "@/core/workflows/agent/drivers/index";
import { selectHostedStatus } from "@/core/workflows/agent/hosted";
import { superwallApi } from "@/core/api/client";
import type { Scope } from "@/core/api/resources";
import { removeSession, readSession, sessionOrgName } from "@/core/account/storage";
import { SUPPORTED_LABEL } from "@/core/codebase/frameworks";
import { scanProject, type DetectedApp } from "@/core/codebase/scan";
import { ui } from "@/ui";
import { withSpinner } from "@/ui/spinner";
import { performLoginWithUi } from "./login";

export async function recoverUnmatchedScope(
  app: DetectedApp,
  apiKey: string,
): Promise<{ scope: Scope; bundleId?: string } | null> {
  for (;;) {
    const orgName = sessionOrgName(readSession());
    const orgLabel = orgName ? `\`${orgName}\`` : "the apps this account can open";
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
      removeSession();
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
      ui.warn(error instanceof Error ? error.message : String(error));
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

  const status = await withSpinner("Checking Superwall Agent credit", () => selectHostedStatus());
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
  const [firstApp] = scan.apps;
  if (!firstApp) {
    const [webApp] = scan.unsupported;
    if (webApp) {
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
    ui.info(
      `Detected \`${firstApp.framework.name}\`` +
        (firstApp.details ? ` · \`${firstApp.details}\`` : "") +
        (firstApp.relPath !== "." ? `  (${firstApp.relPath})` : ""),
    );
    return firstApp;
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
    initialValue: firstApp.path,
  });
  if (choice === null) return null;
  return scan.apps.find((app) => app.path === choice) ?? firstApp;
}

export async function stage(label: string, work: () => Promise<void> | void): Promise<void> {
  ui.step(label);
  await new Promise((resolve) => setTimeout(resolve, 40));
  await work();
}
