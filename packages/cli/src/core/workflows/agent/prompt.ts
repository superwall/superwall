import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DASHBOARD_URL } from "@/environment";
import { packagedDir } from "@/hosts/paths";
import type { ActionContext, WizardAction } from "./actions";

const cache = new Map<string, string>();

export function readPrompt(rel: string, vars: Record<string, string> = {}): string {
  let raw = cache.get(rel);
  if (raw === undefined) {
    raw = readFileSync(join(packagedDir("prompts"), rel), "utf8");
    cache.set(rel, raw);
  }
  return raw
    .replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, key: string, body: string) =>
      vars[key] ? body : "",
    )
    .replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
      const value = vars[key];
      if (value === undefined) throw new Error(`Missing prompt variable "${key}" in ${rel}`);
      return value;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function readCommandments(): string {
  return readPrompt("commandments.xml");
}

export function buildActionPrompt(action: WizardAction, ctx: ActionContext): string {
  const context = readPrompt("context.xml", {
    platform: `${ctx.app.framework.name}${ctx.app.details ? ` (${ctx.app.details})` : ""}`,
    app_dir: ctx.app.path,
    api_key: ctx.apiKey || "(not provided)",
    sdk_installed: ctx.existing.sdkInstalled ? "yes" : "no",
    configure_present: ctx.existing.configureFound ? "yes" : "no",
    docs_url: ctx.app.framework.docsUrl,
    dashboard_url: DASHBOARD_URL,
  });
  return `${context}\n\n${readPrompt(`actions/${action.id}.xml`, action.vars(ctx))}`;
}

export function buildCopyPrompt(action: WizardAction, ctx: ActionContext): string {
  return buildActionPrompt(action, ctx)
    .split("\n")
    .filter((line) => !line.includes("[STATUS]"))
    .join("\n")
    .trimEnd();
}
