import * as fs from "node:fs";
import * as path from "node:path";
import { copyToClipboard } from "@/ui/clipboard";
import { detectDrivers, type AgentEvent, type AgentResult } from "@/core/workflows/agent/drivers/index";
import { readPrompt } from "@/core/workflows/agent/prompt";
import { runWithDriverFallback } from "@/core/workflows/agent/run";
import { readBundledSkill } from "@/core/support/skills";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import { findPaywall, listApplications, type Application } from "@/core/api/resources";
import { readPackageJson, allDeps } from "@/core/codebase/package";
import { DASHBOARD_URL } from "@/environment";
import type { Renderer } from "@/ui";
import { stripReport } from "@/ui/log";
import {
  isScreenOrigin,
  readLock,
  writeApp,
  writeOrigin,
  type PaywallOrigin,
  type ScreenOrigin,
  type SurfaceOrigin,
} from "./project/lock";
import {
  originBrief,
  originConfigSource,
  originOf,
  parseOriginDocument,
  type OriginPaywall,
} from "./project/origin";
import { projectPackageName } from "./project/scaffold";
import { writeProjectFiles, writeSurfaceFiles } from "./project/template";
import {
  readScreen,
  screenBrief,
  screenConfigSource,
  screenFrameworkLabel,
  type ScreenSource,
} from "./screen";

export interface PaywallMigration {
  superwallDir: string;
  surfaceId: string;
  origin: SurfaceOrigin;
  brief: string;
}

const screenFileOf = (migration: PaywallMigration, origin: ScreenOrigin): string =>
  path.resolve(migration.superwallDir, origin.path);

export const migrationSource = (migration: PaywallMigration, from = process.cwd()): string =>
  isScreenOrigin(migration.origin)
    ? path.relative(from, screenFileOf(migration, migration.origin))
    : migration.origin.paywallId;

export const migrationCommand = (migration: PaywallMigration, from = process.cwd()): string =>
  isScreenOrigin(migration.origin)
    ? `superwall migrate --screen ${migrationSource(migration, from)}`
    : `superwall migrate ${migration.origin.paywallId}`;

export const hasOriginal = (migration: PaywallMigration): boolean =>
  !isScreenOrigin(migration.origin) || migration.origin.screenshot !== undefined;

export function isSuperwallProject(dir: string): boolean {
  if (fs.existsSync(path.join(dir, "superwall.lock"))) return true;
  const parsed = readPackageJson(dir);
  return parsed !== undefined && parsed !== null && "superwall" in allDeps(parsed);
}

export function projectDirOf(root: string): string | undefined {
  const nested = path.join(root, "superwall");
  if (isSuperwallProject(nested)) return nested;
  if (isSuperwallProject(root)) return root;
  return undefined;
}

const briefOf = (superwallDir: string, surfaceId: string): string => {
  const file = path.join(superwallDir, "paywalls", surfaceId, "MIGRATION.md");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
};

export function migrationsOf(superwallDir: string): PaywallMigration[] {
  const lock = readLock(superwallDir);
  return Object.entries(lock.origins ?? {})
    .filter(([key]) => key.startsWith("paywall/"))
    .map(([key, origin]) => {
      const surfaceId = key.slice("paywall/".length);
      return { superwallDir, surfaceId, origin, brief: briefOf(superwallDir, surfaceId) };
    });
}

export function migrationFor(
  superwallDir: string,
  paywallId: string,
): PaywallMigration | undefined {
  return migrationsOf(superwallDir).find(
    (entry) => !isScreenOrigin(entry.origin) && entry.origin.paywallId === paywallId,
  );
}

export function screenMigrationFor(
  superwallDir: string,
  file: string,
): PaywallMigration | undefined {
  const absolute = path.resolve(file);
  return migrationsOf(superwallDir).find(
    (entry) => isScreenOrigin(entry.origin) && screenFileOf(entry, entry.origin) === absolute,
  );
}

interface ScreenScaffoldOptions {
  root: string;
  target: string;
  file: string;
  newProject: boolean;
  screenshot?: string;
}

const ORIGINAL_SCREENSHOT = "original.png";

export function scaffoldFromScreen(ui: Renderer, options: ScreenScaffoldOptions): ScreenSource {
  const { root, target, file } = options;
  const screen = readScreen(target, path.resolve(root, file), root);
  const { inventory } = screen;
  const surfaceDir = path.join(target, "paywalls", screen.slug);
  if (fs.existsSync(path.join(surfaceDir, "config.ts"))) {
    throw new Error(
      `\`paywalls/${screen.slug}\` already exists in ${path.relative(root, target) || "."} — rename or remove it first.`,
    );
  }

  if (options.newProject) writeProjectFiles(target, projectPackageName(root));
  writeSurfaceFiles(target, screen.slug, screenConfigSource(screen));
  let screenshot: string | undefined;
  if (options.screenshot !== undefined) {
    fs.copyFileSync(options.screenshot, path.join(surfaceDir, ORIGINAL_SCREENSHOT));
    screenshot = ORIGINAL_SCREENSHOT;
  }
  fs.writeFileSync(path.join(surfaceDir, "MIGRATION.md"), screenBrief(screen, screenshot));
  const origin: ScreenOrigin = {
    path: screen.path,
    framework: screen.framework,
    ...(screenshot === undefined ? {} : { screenshot }),
  };
  writeOrigin(target, "paywall", screen.slug, origin);

  const actions = inventory.actions.reduce((sum, action) => sum + action.count, 0);
  const found = [
    `${inventory.copy.length} string${inventory.copy.length === 1 ? "" : "s"}`,
    `${inventory.assets.length} asset${inventory.assets.length === 1 ? "" : "s"}`,
    `${inventory.productIds.length} product${inventory.productIds.length === 1 ? "" : "s"}`,
    `${actions} action${actions === 1 ? "" : "s"}`,
  ].join(", ");
  ui.step(`Read \`${screen.path}\` (${screenFrameworkLabel(screen.framework)}): ${found}`);
  ui.step(
    `Created ${path.relative(root, target) || "."}/paywalls/${screen.slug} for \`${screen.name}\``,
  );
  if (inventory.productIds.length > 0) {
    ui.warn(
      "Product identifiers were lifted from the source — confirm each exists on the dashboard before pushing.",
    );
  }
  return screen;
}

interface ScaffoldOptions {
  root: string;
  target: string;
  paywallId: string;
  newProject: boolean;
  fetchText?: (url: string) => Promise<string | undefined>;
}

const fetchDocument = (url: string): Promise<string | undefined> =>
  fetch(url)
    .then((response) => (response.ok ? response.text() : undefined))
    .catch(() => undefined);

export async function scaffoldFromPaywall(
  ui: Renderer,
  api: SuperwallApi,
  options: ScaffoldOptions,
): Promise<OriginPaywall> {
  const { root, target, paywallId } = options;
  const spin = ui.spinner();
  spin.start(`Reading paywall ${paywallId}`);
  const detail = await findPaywall(api, paywallId).catch((error: unknown) => {
    spin.stop(`Could not read paywall ${paywallId}`);
    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
      throw new Error(
        `Paywall ${paywallId} isn't visible to this account. Check the id in the dashboard URL.`,
      );
    }
    throw error;
  });
  if (detail.headless) {
    spin.stop(`\`${detail.name ?? paywallId}\` is already code`);
    throw new Error(
      `Paywall ${paywallId} is built with the framework already — pull its source from the dashboard instead of migrating it.`,
    );
  }
  const html =
    detail.url === undefined ? undefined : await (options.fetchText ?? fetchDocument)(detail.url);
  const document = html === undefined ? undefined : parseOriginDocument(html);
  const origin = originOf(detail, document);
  const pages = origin.inventory?.pages ?? 1;
  spin.stop(
    document
      ? `Read \`${origin.name}\`: ${origin.products.length} products, ${pages} page${pages === 1 ? "" : "s"}`
      : `Read \`${origin.name}\` from the API only — its served document could not be fetched, so inventory it by hand`,
  );

  if (fs.existsSync(path.join(target, "paywalls", origin.slug, "config.ts"))) {
    throw new Error(
      `\`paywalls/${origin.slug}\` already exists in ${path.relative(root, target) || "."} — rename or remove it first.`,
    );
  }
  if (options.newProject) writeProjectFiles(target, projectPackageName(root));
  writeSurfaceFiles(target, origin.slug, originConfigSource(origin));
  fs.writeFileSync(path.join(target, "paywalls", origin.slug, "MIGRATION.md"), originBrief(origin));
  if (origin.url !== undefined) {
    writeOrigin(target, "paywall", origin.slug, { paywallId: origin.id, url: origin.url });
  }
  ui.step(
    `Created ${path.relative(root, target) || "."}/paywalls/${origin.slug} from \`${origin.name}\``,
  );
  if (origin.products.some((product) => product.identifier === "missing")) {
    ui.warn(
      "Some product slots have no store product on the dashboard — fix them in config.ts before pushing.",
    );
  }

  if (origin.applicationId !== undefined && origin.platform !== undefined) {
    const lock = readLock(target);
    if (lock.apps[origin.platform] === undefined) {
      writeApp(target, origin.platform, origin.applicationId);
      const known = await listApplications(api).catch((): Application[] => []);
      const app = known.find((candidate) => String(candidate.id) === origin.applicationId);
      if (app) {
        ui.success(
          `Pushes go to \`${app.name ?? app.id}\`, the paywall's app — saved in superwall.lock, so commit that file.`,
        );
      } else {
        ui.success(
          `Pushes go to app ${origin.applicationId}, the paywall's app — saved in superwall.lock.`,
        );
      }
    }
  }
  return origin;
}

const SCREEN_REFERENCE: Record<ScreenOrigin["framework"], string> = {
  swiftui: "ios",
  uikit: "ios",
  compose: "android",
  "android-views": "android",
  "react-native": "react-native",
  flutter: "flutter",
};

const screenPrompt = (migration: PaywallMigration, origin: ScreenOrigin): string =>
  readPrompt("actions/screen-migrate.xml", {
    project_dir: migration.superwallDir,
    surface_dir: `paywalls/${migration.surfaceId}`,
    source_path: origin.path,
    framework: screenFrameworkLabel(origin.framework),
    screenshot:
      origin.screenshot === undefined
        ? "none"
        : `paywalls/${migration.surfaceId}/${origin.screenshot}`,
    dashboard_url: DASHBOARD_URL,
    skill: readBundledSkill("superwall-screen-migrate", SCREEN_REFERENCE[origin.framework]),
    brief: migration.brief || "(MIGRATION.md is missing — inventory the source file first.)",
  });

const paywallPrompt = (migration: PaywallMigration, origin: PaywallOrigin): string =>
  readPrompt("actions/paywall-migrate.xml", {
    project_dir: migration.superwallDir,
    surface_dir: `paywalls/${migration.surfaceId}`,
    paywall_id: origin.paywallId,
    source_url: origin.url,
    dashboard_url: DASHBOARD_URL,
    skill: readBundledSkill("superwall-paywall-migrate"),
    brief:
      migration.brief || "(MIGRATION.md is missing — inventory the source from its URL first.)",
  });

export function buildMigrationPrompt(migration: PaywallMigration): string {
  return isScreenOrigin(migration.origin)
    ? screenPrompt(migration, migration.origin)
    : paywallPrompt(migration, migration.origin);
}

export function buildMigrationCopyPrompt(migration: PaywallMigration): string {
  return buildMigrationPrompt(migration)
    .split("\n")
    .filter((line) => !line.includes("[STATUS]"))
    .join("\n")
    .trimEnd();
}

export interface MigrationRuntime {
  detectDrivers: typeof detectDrivers;
  run: typeof runWithDriverFallback;
  copyToClipboard: typeof copyToClipboard;
}

const runtime: MigrationRuntime = {
  detectDrivers,
  run: runWithDriverFallback,
  copyToClipboard,
};

export async function runMigration(
  migration: PaywallMigration,
  onEvent?: (event: AgentEvent) => void,
  deps: MigrationRuntime = runtime,
): Promise<AgentResult> {
  const drivers = await deps.detectDrivers();
  if (drivers.length === 0) {
    throw new Error("No coding agent found (Claude Code or Codex) — copy the prompt instead.");
  }
  return deps.run(
    drivers.map((detected) => detected.driver),
    {
      prompt: buildMigrationPrompt(migration),
      cwd: migration.superwallDir,
      capabilities: { filesystem: "write", network: true, shell: "unrestricted" },
      onEvent,
    },
  );
}

type MigrationChoice = "agent" | "copy" | "later";

export async function offerMigration(
  ui: Renderer,
  interactive: boolean,
  migration: PaywallMigration,
  forced?: MigrationChoice,
  deps: MigrationRuntime = runtime,
): Promise<MigrationChoice> {
  const drivers = await deps.detectDrivers();
  const agentName = drivers[0]?.info.displayName;
  let choice: MigrationChoice = forced ?? "later";
  if (forced === undefined && interactive) {
    const picked = await ui.select({
      message: "Rebuild the pages now?",
      options: [
        ...(agentName === undefined
          ? []
          : [
              {
                value: "agent",
                label: `With ${agentName}`,
                hint: "runs here, headless; you review in the studio after",
              },
            ]),
        {
          value: "copy",
          label: "Copy the prompt",
          hint: "paste it into Claude Code, Codex, Cursor, or another agent",
        },
        {
          value: "later",
          label: "Not now",
          hint: `${migrationCommand(migration)} picks this up later`,
        },
      ],
      initialValue: agentName === undefined ? "copy" : "agent",
    });
    choice = picked === "agent" || picked === "copy" ? picked : "later";
  }

  if (choice === "copy") {
    const prompt = buildMigrationCopyPrompt(migration);
    const copied = await deps.copyToClipboard(prompt);
    if (copied) {
      ui.note(
        isScreenOrigin(migration.origin)
          ? "Paste it into Claude Code, Codex, Cursor, or another coding agent, opened in the app's root so it can read the source screen."
          : "Paste it into Claude Code, Codex, Cursor, or another coding agent, opened in the superwall/ directory.",
        "Migration prompt copied to clipboard",
      );
    } else {
      ui.note(prompt, "Migration prompt (copy it manually)");
    }
  } else if (choice === "agent") {
    const spin = ui.spinner();
    spin.start(`Rebuilding paywalls/${migration.surfaceId}`);
    const result = await runMigration(
      migration,
      (event) => {
        if (event.type === "status") spin.message(event.text);
      },
      deps,
    );
    if (!result.ok) {
      spin.stop("The agent stopped before finishing.");
      if (result.finalText) ui.report(stripReport(result.finalText).slice(0, 1500));
      throw new Error("The rebuild did not complete.");
    }
    spin.stop(`Rebuilt paywalls/${migration.surfaceId}`);
    if (result.finalText) ui.report(stripReport(result.finalText).slice(0, 1500));
  }
  return choice;
}
