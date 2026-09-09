import { globSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { CommandContext } from "@/command";
import type { FrameworkProject, FrameworkSurface } from "@/core/paywalls/project/framework";
import { ui } from "@/ui";
import { LAYOUT_HINT } from "./report";

export function projectDir(context: CommandContext): string {
  const [first] = projectDirs(context);
  return first ?? process.cwd();
}

export function projectDirs(context: CommandContext): string[] {
  const raw = context.argv.dir;
  const list = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  if (list.length === 0) return [process.cwd()];

  const expanded = list.flatMap((entry) => (entry.includes("*") ? expandGlob(entry) : [entry]));
  return [...new Set(expanded.map((entry) => resolve(entry)))];
}

function expandGlob(pattern: string): string[] {
  try {
    return [...globSync(pattern)]
      .filter((entry) => statSync(entry, { throwIfNoEntry: false })?.isDirectory() ?? false)
      .sort();
  } catch {
    return [pattern];
  }
}

export function requireProject(project: FrameworkProject, dir: string): FrameworkProject {
  if (!project.marker) {
    throw new Error(
      `Not a superwall project: ${dir}\n` +
        "Expected a package.json here (or in superwall/) that depends on superwall.",
    );
  }
  if (project.packageName === "superwall") {
    throw new Error(
      `${project.superwallDir}/package.json is named "superwall".\n` +
        'Node resolves every bare `import "superwall"` inside a package to that package ' +
        "itself, so the framework can never load. Rename it to your project's name.",
    );
  }
  return project;
}

export function parseIds(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return raw
    .flatMap((entry) => (typeof entry === "string" ? entry.split(",") : []))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function selectSurfaces(project: FrameworkProject, ids: unknown): FrameworkSurface[] {
  const wanted = parseIds(ids);
  const known = project.surfaces.map((surface) => surface.id).join(", ");

  if (wanted.length === 0) {
    if (project.surfaces.length === 0) {
      throw new Error(`No paywalls or funnels found — ${LAYOUT_HINT}.`);
    }
    return [...project.surfaces];
  }

  const selected: FrameworkSurface[] = [];
  for (const id of wanted) {
    const matches = project.surfaces.filter((surface) => surface.id === id);
    if (matches.length === 0) {
      throw new Error(
        `No paywall or funnel named "${id}"` +
          (known ? ` — this project has: ${known}.` : ` — ${LAYOUT_HINT}.`),
      );
    }
    if (matches.length > 1) {
      const kinds = matches.map((surface) => `${surface.kind}/${surface.id}`).join(" and ");
      throw new Error(`"${id}" is ambiguous — this project has ${kinds}.`);
    }
    const surface = matches[0];
    if (surface && !selected.includes(surface)) selected.push(surface);
  }
  return selected;
}

export function requireClean(surfaces: readonly FrameworkSurface[]): void {
  const problems = surfaces.flatMap((surface) => surface.diagnostics ?? []);
  if (problems.length === 0) return;
  throw new Error(
    [...problems, "", "Publishing is immutable — fix these first, then push again."].join("\n"),
  );
}

export function needsWork(
  built: string,
  pushed: string | undefined,
  live: string | undefined,
): boolean {
  return built !== pushed && built !== live;
}

