import * as fs from "node:fs";
import * as path from "node:path";
import { DASHBOARD_URL } from "@/environment";
import { copyToClipboard } from "@/clipboard";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import {
  getPaywall,
  listApplications,
  projectOrganizationId,
  type Application,
} from "@/core/api/resources";
import { detectDrivers, type AgentEvent, type AgentResult } from "@/core/agent/drivers";
import { loadPrompt } from "@/core/agent/prompt";
import { runWithDriverFallback } from "@/core/agent/run";
import { loadBundledSkill } from "@/core/agent/skills";
import { originKey, readLock, writeApp, writeOrigin, type SurfaceOrigin } from "./project/lock";
import { originBrief, originConfigSource, originOf, parseOriginDocument, type OriginPaywall } from "./project/origin";
import { projectPackageName } from "./project/scaffold";
import { writeProjectFiles, writeSurfaceFiles } from "./project/template";
import { readPackageJson, allDeps } from "@/core/project/package";
import { stripReport } from "@/ui/log";
import type { Renderer } from "@/ui";

export interface PaywallMigration {
  superwallDir: string;
  surfaceId: string;
  origin: SurfaceOrigin;
  brief: string;
}

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
  return migrationsOf(superwallDir).find((entry) => entry.origin.paywallId === paywallId);
}

export interface ScaffoldOptions {
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
  const detail = await getPaywall(api, paywallId).catch((error: unknown) => {
    spin.stop(`Could not read paywall ${paywallId}`);
    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
      throw new Error(
        `Paywall ${paywallId} isn't visible to this account. Check the id in the dashboard URL, and if it belongs to another organization, switch with \`superwall orgs use <id>\` first.`,
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

  if (options.newProject) writeProjectFiles(target, projectPackageName(root));
  writeSurfaceFiles(target, origin.slug, originConfigSource(origin));
  fs.writeFileSync(path.join(target, "paywalls", origin.slug, "MIGRATION.md"), originBrief(origin));
  if (origin.url !== undefined) {
    writeOrigin(target, "paywall", origin.slug, { paywallId: origin.id, url: origin.url });
  }
  ui.step(`Created ${path.relative(root, target) || "."}/paywalls/${origin.slug} from \`${origin.name}\``);
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
        const organization =
          origin.projectId === undefined
            ? undefined
            : await projectOrganizationId(api, origin.projectId).catch(() => undefined);
        ui.success(
          `Pushes go to app ${origin.applicationId}, the paywall's app — saved in superwall.lock.`,
        );
        ui.warn(
          organization === undefined
            ? "That app is in another organization: run `superwall orgs use <id>` before pushing."
            : `That app is in another organization: run \`superwall orgs use ${organization}\` before pushing.`,
        );
      }
    }
  }
  return origin;
}

export const migrationKey = (surfaceId: string): string => originKey("paywall", surfaceId);

export function buildMigrationPrompt(migration: PaywallMigration): string {
  return loadPrompt("actions/paywall-migrate.xml", {
    project_dir: migration.superwallDir,
    surface_dir: `paywalls/${migration.surfaceId}`,
    paywall_id: migration.origin.paywallId,
    source_url: migration.origin.url,
    dashboard_url: DASHBOARD_URL,
    skill: loadBundledSkill("superwall-paywall-migrate"),
    brief: migration.brief || "(MIGRATION.md is missing — inventory the source from its URL first.)",
  });
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

export type MigrationChoice = "agent" | "copy" | "later";

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
          hint: `superwall migrate ${migration.origin.paywallId} picks this up later`,
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
        "Paste it into Claude Code, Codex, Cursor, or another coding agent, opened in the superwall/ directory.",
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
