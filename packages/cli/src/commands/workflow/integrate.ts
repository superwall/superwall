import { DASHBOARD_URL, VERSION } from "@/constants";
import { ui } from "@/ui";
import { withSpinner } from "@/ui/spinner";
import { defineCommand, type CommandContext, type DefinedCommand } from "@/command";
import { loadReport } from "@/core/state/reports";
import { detectDrivers } from "@/core/agent/drivers";
import { detectExisting } from "@/core/project/existing";
import { detectBilling } from "@/core/project/billing";
import { resolveAccount } from "@/core/account";
import {
  resolveAppBinding,
  resolveScopeFromKey,
  platformForIntegration,
} from "@/core/account/bind";
import { loadSession } from "@/core/auth/storage";
import type { ProvisionedApp } from "@/core/auth/login";
import { getOnboardedApp } from "@/core/state/config";
import { SuperwallApi } from "@/core/api/client";
import { discoverPublicApiKey } from "@/core/api/discover";
import { platformLabel, type Scope } from "@/core/api/resources";
import { apiKeyFromEnv } from "@/util/env";
import {
  runProductsStage,
  runPaywallStage,
  runVerifyStage,
  type StageCtx,
} from "@/core/dashboard/stages";
import { runFallback } from "@/core/agent/fallback";
import { actionById, type ActionContext, type ActionId } from "@/core/agent/actions";
import {
  chooseAction,
  ensureAgentDriverReady,
  performLoginWithUi,
  pickApp,
  recoverUnmatchedScope,
  stage,
} from "./integrate/app";
import { ensureSkillsCurrent } from "@/core/agent/skills";
import { setTelemetryTags } from "@/core/telemetry";
import { copyIntegrationPrompt, finish, printPlan, runActionWithUI } from "./integrate/agent";
import { runCampaignsAndPlacements } from "./integrate/campaigns";

export const runIntegrate = defineCommand({
  name: "integrate",
  auth: "optional",
  telemetry: "workflow",
  run: runPipeline,
});

export function runActionCommand(action: ActionId): DefinedCommand<"optional"> {
  return defineCommand({
    name: action,
    auth: "optional",
    telemetry: "workflow",
    run: (ctx) => runFlow(ctx, action),
  });
}

async function runPipeline(ctx: CommandContext): Promise<void> {
  const { installDir, dryRun, argv } = ctx;
  ui.intro(`Superwall v${VERSION}`);

  const drivers = await withSpinner("Checking your setup", () => detectDrivers());
  if (drivers.length === 0) {
    ui.warn("No coding agent found.");
    await runFallback(installDir);
    return;
  }
  // `--driver claude|codex|superwall` forces a specific backend (bench/A-B); default = first detected.
  const wanted = argv.driver as string | undefined;
  const picked = wanted ? drivers.find((d) => d.driver.id === wanted) : drivers[0];
  if (wanted && !picked) {
    throw new Error(
      `Driver "${wanted}" not available. Detected: ${drivers.map((d) => d.driver.id).join(", ") || "none"}.`,
    );
  }
  const driver = picked!.driver;
  const fallbackDrivers = wanted
    ? []
    : drivers.filter((candidate) => candidate !== picked).map((candidate) => candidate.driver);

  const app = await pickApp(installDir, ctx.interactive);
  if (!app) return;
  setTelemetryTags({ driver: driver.id, framework: app.framework.integration });

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

  // Login is lazy: local agents can run without it, while the bundled
  // Superwall Agent needs OAuth because its hosted grant is user-scoped.
  let session = loadSession();
  if (session?.apiKey) process.env.SUPERWALL_API_KEY = session.apiKey;

  // Resolve the app scope in the background so the dashboard stages don't wait on it mid-flow.
  let scopePromise: ReturnType<typeof resolveScopeFromKey> | null = null;
  if (session && existing.apiKey) {
    scopePromise = resolveScopeFromKey(SuperwallApi.fromSession(), existing.apiKey).catch(
      () => null,
    );
  }

  const provisionedRef: { current: ProvisionedApp | null } = { current: null };
  const ensureLogin = async (): Promise<boolean> => {
    if (session) return true;
    if (!ctx.interactive || dryRun) return false;
    const signedIn = await performLoginWithUi(app, (result) => {
      provisionedRef.current = result;
    });
    if (!signedIn) return false;
    session = signedIn;
    if (session.apiKey) process.env.SUPERWALL_API_KEY = session.apiKey;
    return true;
  };

  let apiKey = existing.apiKey ?? "";
  const flagKey = (argv.apiKey as string | undefined) ?? apiKeyFromEnv();
  let scope: Scope | null = null;
  let bundleId: string | undefined;
  // Project listings can 403 for up to a minute after onboarding; reuse what
  // this machine created instead of asking the API again.
  if (!apiKey && !flagKey) {
    const remembered = getOnboardedApp(app.path);
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
          discoverPublicApiKey(SuperwallApi.fromSession()),
        );
        if (disc) {
          apiKey = disc.apiKey;
          ui.info(`Using app \`${disc.app.name ?? disc.app.bundle_id ?? disc.app.id}\``);
        }
      }
    } else if (await ensureLogin()) {
      const provisioned = provisionedRef.current;
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
          const bound = await resolveAppBinding(SuperwallApi.fromSession(), {
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
          ui.warn((e as Error).message);
        }
      }
    }
  }
  if (!apiKey) {
    const account = await resolveAccount({
      existing,
      argv,
      interactive: ctx.interactive,
      ui: ctx.ui,
    });
    if (!account) return void ui.warn("Cancelled.");
    apiKey = account.apiKey;
  }
  const ctxAction: ActionContext = { app, apiKey, existing };
  const ensureAgentReady = () => ensureAgentDriverReady(driver, ensureLogin, dryRun);

  ui.step("Step 1 · Integrate the SDK");
  if (existing.fullyIntegrated) {
    ui.info("SDK already integrated - skipped.");
    if (!dryRun) await ensureSkillsCurrent();
  } else if (!dryRun) {
    const how = !ctx.interactive
      ? "now"
      : await ui.select({
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

  // Dashboard stages run whenever we can resolve scope - interactively (after
  // app-binding) OR headless/CI when a session + app key are already present, so
  // `integrate` is fully non-interactive-capable (and benchable end-to-end).
  const canResolveHeadless = !ctx.interactive && !!apiKey && !!loadSession();
  // Headless with NO session: placements/campaigns stages can't run. Fail LOUDLY
  // instead of exiting 0 with a silently half-done setup — callers (CI, benches,
  // scripts) must see that the integration is incomplete.
  if (!dryRun && !ctx.interactive && !loadSession()) {
    ui.warn(
      "You aren't logged in — headless mode cannot run the placements/campaigns stages. " +
        "Run `superwall login` first. The SDK code changes (if any) were applied, but the integration is INCOMPLETE.",
    );
    process.exitCode = 1;
  }
  if (!dryRun && !scope && (canResolveHeadless || (ctx.interactive && (await ensureLogin())))) {
    const resolved = await withSpinner("Finding this app in Superwall", () =>
      scopePromise
        ? scopePromise
        : resolveScopeFromKey(SuperwallApi.fromSession(), apiKey).catch(() => null),
    );
    if (resolved) {
      scope = resolved;
      bundleId = resolved.bundleId;
    }
  }
  // Key present but no matching app in the org - most likely the wrong account.
  // Offer to re-login / rebind rather than silently ending with a broken setup.
  if (!scope && !dryRun && ctx.interactive && apiKey && (await ensureLogin())) {
    const recovered = await recoverUnmatchedScope(app, apiKey);
    if (recovered) {
      scope = recovered.scope;
      bundleId = recovered.bundleId;
    }
  }
  if (scope) {
    const stageCtx: StageCtx = {
      api: SuperwallApi.fromSession(),
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

async function runFlow(ctx: CommandContext, forced?: ActionId): Promise<void> {
  const { installDir, dryRun, argv } = ctx;
  ui.intro(`Superwall v${VERSION}`);

  const drivers = await withSpinner("Checking your setup", () => detectDrivers());
  if (drivers.length === 0) {
    ui.warn("No coding agent found.");
    await runFallback(installDir);
    return;
  }
  const driver = drivers[0]!;
  const fallbackDrivers = drivers.slice(1).map((candidate) => candidate.driver);
  let session = loadSession();

  const app = await pickApp(installDir, ctx.interactive);
  if (!app) return void ui.warn("Cancelled.");

  const provisionedRef: { current: ProvisionedApp | null } = { current: null };
  const ensureLogin = async (): Promise<boolean> => {
    if (session) return true;
    if (!ctx.interactive || dryRun) return false;
    const signedIn = await performLoginWithUi(app, (result) => {
      provisionedRef.current = result;
    });
    if (!signedIn) return false;
    session = signedIn;
    if (session.apiKey) process.env.SUPERWALL_API_KEY = session.apiKey;
    return true;
  };
  setTelemetryTags({
    driver: driver.driver.id,
    framework: app.framework.integration,
  });

  const existing = detectExisting(app);
  if (existing.fullyIntegrated) ui.success(`Superwall is already set up in \`${app.name}\`.`);
  else if (existing.sdkInstalled) ui.info(`Partial Superwall setup found in \`${app.name}\`.`);

  const choice = await chooseAction(forced, existing, app, ctx.interactive);
  if (!choice) return;
  const action = actionById[choice];

  if (action.requiresOrgKey && !process.env.SUPERWALL_API_KEY && !loadSession()) {
    ui.warn(
      "That needs an authenticated session - run `superwall login` first (or set SUPERWALL_API_KEY).",
    );
    ui.outro("");
    return;
  }

  let apiKey = existing.apiKey ?? "";
  if (action.id === "integrate" || action.id === "dashboard-setup") {
    const flagKey = (argv.apiKey as string | undefined) ?? apiKeyFromEnv();
    if (!apiKey && !flagKey) {
      const remembered = getOnboardedApp(app.path);
      if (remembered) {
        apiKey = remembered.publicApiKey;
        ui.info(`Using \`${app.name}\` - created during onboarding.`);
      }
    }
    if (!apiKey && !flagKey && ctx.interactive && (await ensureLogin())) {
      if (provisionedRef.current?.publicApiKey) {
        apiKey = provisionedRef.current.publicApiKey;
        ui.success(`Created \`${app.name}\` in Superwall`);
      } else {
        try {
          const bound = await resolveAppBinding(SuperwallApi.fromSession(), {
            platform: platformForIntegration(app.integration),
            appName: app.name,
          });
          if (!bound) return void ui.warn("Cancelled.");
          apiKey = bound.apiKey;
        } catch (e) {
          ui.warn((e as Error).message);
        }
      }
    }
    if (!apiKey) {
      const account = await resolveAccount({
        existing,
        argv,
        interactive: ctx.interactive,
        ui: ctx.ui,
      });
      if (!account) return void ui.warn("Cancelled.");
      apiKey = account.apiKey;
    }
  }

  const priorReport =
    action.id === "review-fix"
      ? loadReport(app.path, "review")
      : action.id === "placements-implement"
        ? loadReport(app.path, "placements-review")
        : undefined;
  const actionCtx: ActionContext = { app, apiKey, existing, priorReport };

  if (dryRun) {
    printPlan(driver.info.displayName, action, actionCtx);
    ui.outro("Dry run - no changes made.");
    return;
  }

  if (action.id === "integrate" && existing.fullyIntegrated) {
    ui.note("SDK + configure() already present - no code changes made.", "Already integrated");
  } else {
    if (!(await ensureAgentDriverReady(driver.driver, ensureLogin, dryRun))) return;
    await runActionWithUI(driver.driver, fallbackDrivers, action, actionCtx);
  }

  await ensureSkillsCurrent(action.id === "integrate" && !existing.fullyIntegrated);
  finish(ctx, action);
}
