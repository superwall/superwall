import { resolveAccount } from "@/core/account";
import { resolveAppBinding, resolveScopeFromKey, platformForIntegration } from "@/core/account/bind";
import { actionById, type ActionContext } from "@/core/workflows/agent/actions";
import { detectDrivers } from "@/core/workflows/agent/drivers/index";
import { runFallback } from "@/core/workflows/agent/fallback";
import { ensureSkillsCurrent } from "@/core/support/skills";
import { superwallApi } from "@/core/api/client";
import { discoverPublicApiKey } from "@/core/api/discover";
import { platformLabel, type Scope } from "@/core/api/resources";
import { readSession } from "@/core/account/storage";
import { runProductsStage, runPaywallStage, runVerifyStage, type StageCtx } from "@/core/workflows/dashboard-setup";
import { detectBilling } from "@/core/codebase/billing";
import { detectExisting } from "@/core/codebase/existing";
import { readOnboardedApp } from "@/core/state/config";
import { readReport } from "@/core/state/reports";
import { updateTelemetryTags } from "@/core/support/telemetry";
import { DASHBOARD_URL, VERSION } from "@/environment";
import type { CommandOutput } from "@/program/output";
import { ui, type Renderer } from "@/ui";
import { withSpinner } from "@/ui/spinner";
import { copyIntegrationPrompt, finish, printPlan, runActionWithUI } from "./agent";
import { ensureAgentDriverReady, pickApp, recoverUnmatchedScope, stage } from "./app";
import { runCampaignsAndPlacements } from "./campaigns";
import { createLoginGate } from "./login";

export interface WorkflowOptions {
  installDir: string;
  dryRun: boolean;
  interactive: boolean;
  ui: Renderer;
  output: CommandOutput;
}

export async function runIntegrate(
  ctx: WorkflowOptions & { apiKey: string | undefined; driver: string | undefined },
): Promise<void> {
  const { installDir, dryRun } = ctx;
  ui.intro(`Superwall v${VERSION}`);

  const drivers = await withSpinner("Checking your setup", () => detectDrivers());
  const [first] = drivers;
  if (!first) {
    ui.warn("No coding agent found.");
    await runFallback(installDir);
    return;
  }
  const wanted = ctx.driver;
  const picked = wanted ? drivers.find((d) => d.driver.id === wanted) : first;
  if (!picked) {
    throw new Error(
      `Driver "${wanted}" not available. Detected: ${drivers.map((d) => d.driver.id).join(", ")}.`,
    );
  }
  const driver = picked.driver;
  const fallbackDrivers = wanted
    ? []
    : drivers.filter((candidate) => candidate !== picked).map((candidate) => candidate.driver);

  const app = await pickApp(installDir, ctx.interactive);
  if (!app) return;
  updateTelemetryTags({ driver: driver.id, framework: app.framework.integration });

  const existing = detectExisting(app);
  if (existing.fullyIntegrated) ui.success(`Superwall is already set up in \`${app.name}\`.`);
  else if (existing.sdkInstalled) ui.info(`Partial Superwall setup found in \`${app.name}\`.`);

  const billing = detectBilling(app);
  if (billing.revenueCat && ctx.interactive) {
    const intent = await ui.select({
      message: "You're using `RevenueCat`. What do you want Superwall for?",
      options: [
        {
          value: "paywalls",
          label: "Paywalls only - keep RevenueCat for billing",
        },
        { value: "migrate", label: "Fully migrate to Superwall" },
        { value: "later", label: "Decide later" },
      ],
      initialValue: "paywalls",
    });
    if (intent === null) return;
    ui.info(`RevenueCat: \`${intent}\``);
  }

  const session = readSession();

  let scopePromise: ReturnType<typeof resolveScopeFromKey> | null = null;
  if (session && existing.apiKey) {
    scopePromise = resolveScopeFromKey(superwallApi(), existing.apiKey).catch(() => null);
  }

  const login = createLoginGate(app, { session, interactive: ctx.interactive, dryRun });
  const ensureLogin = login.ensure;

  let apiKey = existing.apiKey ?? "";
  const flagKey = ctx.apiKey;
  let scope: Scope | null = null;
  let bundleId: string | undefined;
  if (!apiKey && !flagKey) {
    const remembered = readOnboardedApp(app.path);
    if (remembered) {
      apiKey = remembered.publicApiKey;
      if (remembered.projectId && remembered.applicationId) {
        scope = {
          projectId: remembered.projectId,
          applicationId: remembered.applicationId,
          appName: app.name,
        };
      }
      ui.info(`Using \`${app.name}\` - created during onboarding.`);
    }
  }
  if (!apiKey && !flagKey) {
    if (!ctx.interactive) {
      if (session) {
        const disc = await withSpinner("Finding your app", () =>
          discoverPublicApiKey(superwallApi()),
        );
        if (disc) {
          apiKey = disc.apiKey;
          ui.info(`Using app \`${disc.app.name ?? disc.app.bundle_id ?? disc.app.id}\``);
        }
      }
    } else if (await ensureLogin()) {
      const provisioned = login.provisioned();
      if (provisioned?.publicApiKey) {
        apiKey = provisioned.publicApiKey;
        if (provisioned.projectId && provisioned.applicationId) {
          scope = {
            projectId: provisioned.projectId,
            applicationId: provisioned.applicationId,
            appName: app.name,
          };
        }
        ui.success(`Created \`${app.name}\` in Superwall`);
      } else {
        try {
          const bound = await resolveAppBinding(superwallApi(), {
            platform: platformForIntegration(app.integration),
            appName: app.name,
          });
          if (!bound) return void ui.warn("Cancelled.");
          apiKey = bound.apiKey;
          scope = {
            projectId: bound.projectId,
            applicationId: bound.applicationId,
            appName: app.name,
          };
          bundleId = bound.app.bundle_id;
          ui.success(
            `Using \`${bound.app.name ?? bound.app.id}\` (${platformLabel(bound.app.platform)})`,
          );
        } catch (e) {
          ui.warn(e instanceof Error ? e.message : String(e));
        }
      }
    }
  }
  if (!apiKey) {
    const account = await resolveAccount({
      existing,
      apiKey: ctx.apiKey,
      interactive: ctx.interactive,
      ui: ctx.ui,
    });
    if (!account) return void ui.warn("Cancelled.");
    apiKey = account.apiKey;
  }
  if (session?.apiKey) process.env.SUPERWALL_API_KEY = session.apiKey;
  const ctxAction: ActionContext = { app, apiKey, existing };
  const ensureAgentReady = () => ensureAgentDriverReady(driver, ensureLogin, dryRun);

  ui.step("Step 1 · Integrate the SDK");
  if (existing.fullyIntegrated) {
    ui.info("SDK already integrated - skipped.");
    if (!dryRun) await ensureSkillsCurrent();
  } else if (!dryRun) {
    let how: string | null = "now";
    if (ctx.interactive) {
      how = await ui.select({
        message: `Integrate the Superwall SDK into \`${app.name}\`?`,
        options: [
          { value: "now", label: "Integrate for me" },
          {
            value: "copy",
            label: "Copy the prompt",
            hint: "Run it in your own agent",
          },
        ],
        initialValue: "now",
      });
    }
    if (how === null) return void ui.warn("Cancelled.");
    if (how === "copy") {
      await copyIntegrationPrompt(ctxAction);
      return void ui.outro("Paste it into your agent, then run `superwall integrate` to continue.");
    }
    if (!(await ensureAgentReady())) {
      if (ctx.interactive) {
        await copyIntegrationPrompt(ctxAction);
        ui.outro("Paste it into your agent, or run `superwall login` and try again.");
      }
      return;
    }
    await runActionWithUI(driver, fallbackDrivers, actionById["integrate"], ctxAction);
    await ensureSkillsCurrent(true);
  }

  const canResolveHeadless = !ctx.interactive && !!apiKey && !!readSession();
  if (!dryRun && !ctx.interactive && !readSession()) {
    ui.warn(
      "You aren't logged in — headless mode cannot run the placements/campaigns stages. " +
        "Run `superwall login` first. The SDK code changes (if any) were applied, but the integration is INCOMPLETE.",
    );
    process.exitCode = 1;
  }
  if (!dryRun && !scope && (canResolveHeadless || (ctx.interactive && (await ensureLogin())))) {
    const resolved = await withSpinner("Finding this app in Superwall", () => {
      return scopePromise ?? resolveScopeFromKey(superwallApi(), apiKey).catch(() => null);
    });
    if (resolved) {
      scope = resolved;
      bundleId = resolved.bundleId;
    }
  }
  if (!scope && !dryRun && ctx.interactive && apiKey && (await ensureLogin())) {
    const recovered = await recoverUnmatchedScope(app, apiKey);
    if (recovered) {
      scope = recovered.scope;
      bundleId = recovered.bundleId;
    }
  }
  if (scope) {
    const stageCtx: StageCtx = {
      api: superwallApi(),
      scope,
      appName: app.name,
      bundleId,
      projectDir: app.path,
    };
    await stage("Step 2 · Products", () => runProductsStage(stageCtx));
    await stage("Step 3 · Campaigns & Placements", () =>
      runCampaignsAndPlacements(driver, fallbackDrivers, ctxAction, stageCtx, ensureAgentReady),
    );
    await stage("Step 4 · Paywall", () => runPaywallStage());
    await stage("Step 5 · Verify", () => runVerifyStage(stageCtx));
  } else if (!dryRun && ctx.interactive) {
    ui.error(
      "Couldn't connect this app to Superwall - set it up in the dashboard, or re-run to try again.",
    );
    process.exitCode = 1;
  }

  ui.outro(`Done.  ${DASHBOARD_URL}`);
}

export async function runReview(ctx: WorkflowOptions, fix: boolean): Promise<void> {
  const { installDir, dryRun } = ctx;
  ui.intro(`Superwall v${VERSION}`);

  const [driver, ...fallbacks] = await withSpinner("Checking your setup", () => detectDrivers());
  if (!driver) {
    ui.warn("No coding agent found.");
    await runFallback(installDir);
    return;
  }
  const fallbackDrivers = fallbacks.map((candidate) => candidate.driver);

  const app = await pickApp(installDir, ctx.interactive);
  if (!app) return void ui.warn("Cancelled.");

  const login = createLoginGate(app, {
    session: readSession(),
    interactive: ctx.interactive,
    dryRun,
  });
  updateTelemetryTags({
    driver: driver.driver.id,
    framework: app.framework.integration,
  });

  const existing = detectExisting(app);
  if (existing.fullyIntegrated) ui.success(`Superwall is already set up in \`${app.name}\`.`);
  else if (existing.sdkInstalled) ui.info(`Partial Superwall setup found in \`${app.name}\`.`);

  const action = actionById[fix ? "review-fix" : "review"];
  const priorReport = fix ? readReport(app.path, "review") : undefined;
  const actionCtx: ActionContext = { app, apiKey: existing.apiKey ?? "", existing, priorReport };

  if (dryRun) {
    printPlan(driver.info.displayName, action, actionCtx);
    ui.outro("Dry run - no changes made.");
    return;
  }

  if (!(await ensureAgentDriverReady(driver.driver, login.ensure, dryRun))) return;
  await runActionWithUI(driver.driver, fallbackDrivers, action, actionCtx);

  await ensureSkillsCurrent();
  finish(ctx.output, action);
}
