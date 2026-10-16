import * as fs from "node:fs";
import * as path from "node:path";
import { DASHBOARD_URL, VERSION } from "@/environment";
import { ui } from "@/ui";
import { defineCommand, type CommandContext } from "@/command";
import {
  buildMigrationCopyPrompt,
  hasOriginal,
  migrationFor,
  migrationSource,
  offerMigration,
  projectDirOf,
  scaffoldFromPaywall,
  scaffoldFromScreen,
  screenMigrationFor,
} from "@/core/paywalls/migration";
import { findScreenCandidates, placementOfName, screenNameOf } from "@/core/paywalls/screen";
import { askForScreenshot } from "@/core/paywalls/simulator";
import { requireApi } from "@/core/paywalls/project/session";
import {
  askStudio,
  migrationNextSteps,
  screenNextSteps,
  startStudio,
} from "@/commands/paywalls/open-studio";
import { blocks } from "@/output";
import { stripReport } from "@/ui/log";
import { detectDrivers } from "@/core/agent/drivers";
import { scanProject } from "@/core/project/scan";
import { detectBilling } from "@/core/project/billing";
import { detectExisting } from "@/core/project/existing";
import { loadSession, sessionOrgName } from "@/core/auth/storage";
import { performLoginWithUi } from "./integrate/app";
import { runAction } from "@/core/agent/run";
import { saveReport } from "@/core/state/reports";
import { actionById, type ActionContext } from "@/core/agent/actions";

const paywallIdOf = (value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number" ? String(value) : undefined;

async function runPaywallMigrate(ctx: CommandContext, paywallId: string): Promise<void> {
  const { installDir, interactive, argv } = ctx;
  const existingDir = projectDirOf(installDir);
  let migration = existingDir === undefined ? undefined : migrationFor(existingDir, paywallId);

  if (argv.skill) {
    if (migration === undefined) {
      throw new Error(
        `Paywall ${paywallId} isn't in this project yet — run \`superwall migrate ${paywallId}\` once without --skill to scaffold it, then print the prompt.`,
      );
    }
    process.stdout.write(`${buildMigrationCopyPrompt(migration)}\n`);
    return;
  }

  if (migration === undefined) {
    const api = await requireApi(interactive);
    const target = existingDir ?? path.join(installDir, "superwall");
    if (existingDir === undefined && fs.existsSync(path.join(target, "package.json"))) {
      throw new Error(
        `\`${target}\` already has a package.json that isn't a superwall project — move it aside first.`,
      );
    }
    const origin = await scaffoldFromPaywall(ui, api, {
      root: installDir,
      target,
      paywallId,
      newProject: existingDir === undefined,
    });
    migration = migrationFor(target, origin.id);
    if (migration === undefined) {
      throw new Error(
        `Paywall ${paywallId} has no served document to rebuild from — nothing was recorded in superwall.lock.`,
      );
    }
  } else {
    ui.info(
      `\`paywalls/${migration.surfaceId}\` was scaffolded from paywall ${paywallId} — picking up the rebuild.`,
    );
  }

  const choice = await offerMigration(ui, interactive, migration);
  const opening = choice === "agent" && (await askStudio(ui, interactive, migration.surfaceId));
  ctx.output.render(
    blocks.nextSteps(
      migrationNextSteps(
        opening,
        path.relative(installDir, migration.superwallDir) || ".",
        paywallId,
        choice,
      ),
    ),
    blocks.outro(`Done.  ${DASHBOARD_URL}`),
  );
  if (opening) await startStudio(migration.superwallDir, migration.surfaceId);
}

async function pickScreen(ctx: CommandContext): Promise<string | undefined> {
  const { installDir, interactive } = ctx;
  const candidates = findScreenCandidates(installDir);
  if (candidates.length === 0) {
    throw new Error(
      `No screen-like files found under ${path.relative(process.cwd(), installDir) || "."} — pass one: \`superwall migrate --screen <path>\`.`,
    );
  }
  if (!interactive) {
    ui.list({
      items: candidates.map((candidate) => ({ label: candidate.path, meta: candidate.reason })),
    });
    ui.info("Pass one: `superwall migrate --screen <path>`.");
    return undefined;
  }
  const picked = await ui.select({
    message: "Which screen should ship through Superwall?",
    options: candidates.map((candidate) => ({
      value: candidate.path,
      label: candidate.path,
      hint: candidate.reason,
    })),
  });
  return picked ?? undefined;
}

async function runScreenMigrate(ctx: CommandContext, screenArg: string): Promise<void> {
  const { installDir, interactive, argv } = ctx;
  const existingDir = projectDirOf(installDir);
  let file: string | undefined = screenArg === "" ? undefined : path.resolve(screenArg);
  if (file === undefined) {
    if (argv.skill)
      throw new Error("`--skill` needs the screen: `superwall migrate --screen <path> --skill`.");
    const picked = await pickScreen(ctx);
    if (picked === undefined) return;
    file = path.resolve(installDir, picked);
  }
  const shown = path.relative(process.cwd(), file) || ".";
  let migration = existingDir === undefined ? undefined : screenMigrationFor(existingDir, file);

  if (argv.skill) {
    if (migration === undefined) {
      throw new Error(
        `\`${shown}\` isn't in this project yet — run \`superwall migrate --screen ${shown}\` once without --skill to scaffold it, then print the prompt.`,
      );
    }
    process.stdout.write(`${buildMigrationCopyPrompt(migration)}\n`);
    return;
  }

  if (migration === undefined) {
    const target = existingDir ?? path.join(installDir, "superwall");
    if (existingDir === undefined && fs.existsSync(path.join(target, "package.json"))) {
      throw new Error(
        `\`${target}\` already has a package.json that isn't a superwall project — move it aside first.`,
      );
    }
    let screenshot =
      typeof argv.screenshot === "string" ? path.resolve(argv.screenshot) : undefined;
    if (screenshot !== undefined && !fs.existsSync(screenshot)) {
      throw new Error(`No screenshot at \`${argv.screenshot}\`.`);
    }
    if (screenshot === undefined && interactive) screenshot = await askForScreenshot(ui);
    scaffoldFromScreen(ui, {
      root: installDir,
      target,
      file,
      newProject: existingDir === undefined,
      screenshot,
    });
    migration = screenMigrationFor(target, file);
    if (migration === undefined) {
      throw new Error(`\`${shown}\` was not recorded in superwall.lock — nothing to rebuild.`);
    }
  } else {
    ui.info(
      `\`paywalls/${migration.surfaceId}\` was scaffolded from \`${shown}\` — picking up the rebuild.`,
    );
  }

  const choice = await offerMigration(ui, interactive, migration);
  const original = hasOriginal(migration);
  const opening =
    choice === "agent" && (await askStudio(ui, interactive, migration.surfaceId, original));
  ctx.output.render(
    blocks.nextSteps(
      screenNextSteps({
        studioOpening: opening,
        superwallDir: path.relative(installDir, migration.superwallDir) || ".",
        screenPath: migrationSource(migration),
        placement: placementOfName(screenNameOf(file)),
        screenshot: original,
        choice,
      }),
    ),
    blocks.outro(`Done.  ${DASHBOARD_URL}`),
  );
  if (opening) await startStudio(migration.superwallDir, migration.surfaceId, original);
}

export const runMigrate = defineCommand({
  name: "migrate",
  auth: "optional",
  async run(ctx) {
    const { installDir, dryRun } = ctx;
    if (typeof ctx.argv.screen === "string") {
      if (!ctx.argv.skill) ui.intro(`Superwall migrate v${VERSION}`);
      await runScreenMigrate(ctx, ctx.argv.screen);
      return;
    }
    const paywallId = paywallIdOf(ctx.argv.paywall);
    if (paywallId !== undefined) {
      if (!ctx.argv.skill) ui.intro(`Superwall migrate v${VERSION}`);
      await runPaywallMigrate(ctx, paywallId);
      return;
    }
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
      throw new Error("No iOS / Android / Expo / React Native / Flutter app found here.");
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
        `Logged in as \`${session.userEmail ?? "you"}\`${sessionOrgName(session) ? ` · \`${sessionOrgName(session)}\`` : ""}`,
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
