import { DASHBOARD_URL, VERSION } from "@/constants";
import { ui } from "@/ui";
import { defineCommand } from "@/command";
import { blocks } from "@/output";
import { stripReport } from "@/ui/log";
import { detectDrivers } from "@/core/agent/drivers";
import { scanProject } from "@/core/project/scan";
import { detectBilling } from "@/core/project/billing";
import { detectExisting } from "@/core/project/existing";
import { loadSession } from "@/core/auth/storage";
import { performLoginWithUi } from "./integrate/app";
import { runAction } from "@/core/agent/run";
import { saveReport } from "@/core/state/reports";
import { actionById, type ActionContext } from "@/core/agent/actions";

export const runMigrate = defineCommand({
  name: "migrate",
  auth: "optional",
  async run(ctx) {
    const { installDir, dryRun } = ctx;
    ui.intro(`Superwall migrate v${VERSION}`);

    const drivers = await detectDrivers();
    if (drivers.length === 0) {
      throw new Error("No coding agent found (Claude Code or Codex).");
    }
    const driver = drivers[0]!.driver;
    const fallbackDrivers = drivers.slice(1).map((candidate) => candidate.driver);

    const scan = await scanProject(installDir);
    const app = scan.apps[0];
    if (!app) {
      throw new Error("No iOS / Expo / React Native / Flutter app found here.");
    }
    ui.info(`Detected \`${app.framework.name}\`${app.details ? ` · \`${app.details}\`` : ""}`);

    const billing = detectBilling(app);
    const provider = billing.revenueCat
      ? "RevenueCat"
      : billing.adapty
        ? "Adapty"
        : billing.qonversion
          ? "Qonversion"
          : null;
    if (!provider) {
      ui.warn("No RevenueCat / Adapty / Qonversion detected - nothing to migrate.");
      ui.info("Starting fresh? Run `superwall integrate` to set up directly.");
      ui.outro("");
      return;
    }
    ui.info(`Found \`${provider}\``);

    let intent = "full";
    if (ctx.interactive && !dryRun) {
      const sel = await ui.select({
        message: `Migrate from ${provider} - how far?`,
        options: [
          {
            value: "full",
            label: "Full migration",
            hint: `replace ${provider} with Superwall`,
          },
          {
            value: "paywalls",
            label: "Paywalls only",
            hint: `keep ${provider} for billing`,
          },
        ],
        initialValue: "full",
      });
      if (sel === null) return void ui.warn("Cancelled.");
      intent = sel;
    }

    // Log in so the agent's `superwall` CLI calls are authenticated.
    let session = loadSession();
    if (session) {
      ui.success(
        `Logged in as \`${session.userEmail ?? "you"}\`${session.orgName ? ` · \`${session.orgName}\`` : ""}`,
      );
    } else if (ctx.interactive && !dryRun) {
      session = await performLoginWithUi();
    }
    if (session?.apiKey) process.env.SUPERWALL_API_KEY = session.apiKey;

    const existing = detectExisting(app);
    const actionCtx: ActionContext = {
      app,
      apiKey: existing.apiKey ?? "",
      existing,
      billingProvider: provider,
      migrateIntent: intent,
    };

    if (dryRun) {
      ui.note(
        [
          `Provider:  ${provider}`,
          `Mode:      ${intent}`,
          `App:       ${app.name} (${app.framework.name})`,
          `Path:      ${app.path}`,
        ].join("\n"),
        "Migration plan",
      );
      ui.outro("Dry run - no changes made.");
      return;
    }

    const spin = ui.spinner();
    spin.start(`Migrating from ${provider}`);
    const result = await runAction({
      driver,
      fallbackDrivers,
      action: actionById["migrate"],
      ctx: actionCtx,
      onEvent: (e) => {
        if (e.type === "status") spin.message(e.text);
      },
    });
    if (result.ok) {
      spin.stop("Migration complete");
      if (result.finalText) {
        const plain = stripReport(result.finalText);
        saveReport(app.path, "migrate", plain);
        ui.report(plain);
      }
    } else {
      spin.stop("Migration stopped early");
      if (result.finalText) ui.report(stripReport(result.finalText).slice(0, 1500));
      throw new Error("Migration did not complete.");
    }
    ctx.output.render(
      blocks.nextSteps([
        "Rebuild your paywalls - as code (`superwall create`) or in the dashboard editor - and attach products.",
        "Verify a purchase on device.",
      ]),
      blocks.outro(`Done.  ${DASHBOARD_URL}`),
    );
  },
});
