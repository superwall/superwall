import * as fs from "node:fs";
import * as path from "node:path";
import { actionById, type ActionContext } from "@/core/workflows/agent/actions";
import { detectDrivers } from "@/core/workflows/agent/drivers/index";
import { runAction } from "@/core/workflows/agent/run";
import { readSession, sessionOrgName } from "@/core/account/storage";
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
import { askStudio, migrationNextSteps, screenNextSteps, startStudio } from "@/core/paywalls/studio/open";
import { requireApi } from "@/core/paywalls/project/session";
import { findScreenCandidates, placementOfName, screenNameOf } from "@/core/paywalls/screen";
import { askForScreenshot } from "@/core/paywalls/simulator";
import { detectBilling } from "@/core/codebase/billing";
import { detectExisting } from "@/core/codebase/existing";
import { scanProject } from "@/core/codebase/scan";
import { writeReport } from "@/core/state/reports";
import { DASHBOARD_URL, VERSION } from "@/environment";
import { blocks } from "@/program/output";
import { ui } from "@/ui";
import { stripReport } from "@/ui/log";
import type { WorkflowOptions } from "./integrate";
import { performLoginWithUi } from "./login";

export async function runPaywallMigration(
  ctx: WorkflowOptions,
  paywallId: string,
  skill: boolean,
): Promise<void> {
  const { installDir, interactive } = ctx;
  if (!skill) ui.intro(`Superwall migrate v${VERSION}`);
  const existingDir = projectDirOf(installDir);
  let migration = existingDir === undefined ? undefined : migrationFor(existingDir, paywallId);

  if (skill) {
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

async function pickScreen(ctx: WorkflowOptions): Promise<string | undefined> {
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

export async function runScreenMigration(
  ctx: WorkflowOptions,
  screen: { path: string; screenshot: string | undefined },
  skill: boolean,
): Promise<void> {
  const { installDir, interactive } = ctx;
  if (!skill) ui.intro(`Superwall migrate v${VERSION}`);
  const existingDir = projectDirOf(installDir);
  let file: string | undefined = screen.path === "" ? undefined : path.resolve(screen.path);
  if (file === undefined) {
    if (skill) {
      throw new Error("`--skill` needs the screen: `superwall migrate --screen <path> --skill`.");
    }
    const picked = await pickScreen(ctx);
    if (picked === undefined) return;
    file = path.resolve(installDir, picked);
  }
  const shown = path.relative(process.cwd(), file) || ".";
  let migration = existingDir === undefined ? undefined : screenMigrationFor(existingDir, file);

  if (skill) {
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
    let screenshot = screen.screenshot === undefined ? undefined : path.resolve(screen.screenshot);
    if (screenshot !== undefined && !fs.existsSync(screenshot)) {
      throw new Error(`No screenshot at \`${screen.screenshot}\`.`);
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

export async function runProviderMigration(ctx: WorkflowOptions): Promise<void> {
  const { installDir, dryRun } = ctx;
  ui.intro(`Superwall migrate v${VERSION}`);

  const [detected, ...fallbacks] = await detectDrivers();
  if (!detected) {
    throw new Error("No coding agent found (Claude Code or Codex).");
  }
  const driver = detected.driver;
  const fallbackDrivers = fallbacks.map((candidate) => candidate.driver);

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

  let session = readSession();
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
      writeReport(app.path, "migrate", plain);
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
}
