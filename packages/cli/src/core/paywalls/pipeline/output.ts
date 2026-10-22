import pc from "picocolors";
import type { ResolvedBinding } from "@/core/paywalls/binding/binding";

export const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} kB`;

export const weight = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : kb(bytes);

const SHORT_SHA = 7;

const shortSha = (sha: string | undefined): string | undefined =>
  typeof sha === "string" && sha.length >= SHORT_SHA ? sha.slice(0, SHORT_SHA) : undefined;

export function pushedLine(input: {
  version: number;
  snapshotId?: string;
  live?: number;
  promoting: boolean;
}): string {
  const sha = shortSha(input.snapshotId);
  const version = input.promoting
    ? `version ${input.version}`
    : pc.yellow(`version ${input.version}`);
  const pushed = `Pushed ${version}${sha ? ` ${pc.dim(`(${sha})`)}` : ""}`;
  return input.promoting || input.live === undefined
    ? pushed
    : `${pushed} · ${pc.dim(`live ${input.live}`)}`;
}

export function transition(before: number | undefined, after: number): string {
  if (before === undefined) return `Promoted ${pc.green(`version ${after}`)}`;
  if (before === after) return `Version ${pc.green(String(after))} already live`;
  if (after < before) return `Rolled back ${pc.green(`version ${before} → ${after}`)}`;
  return `Promoted ${pc.green(`version ${before} → ${after}`)}`;
}

export const BIND_VERB: Record<ResolvedBinding["source"], string> = {
  lock: "Linked to",
  matched: "Linked to",
  created: "Created",
  renamed: "Rebound after rename to",
};

export const LAYOUT_HINT =
  "expected superwall/{paywalls,funnels}/<id>/ with config.ts and app/index.tsx";

const NOTE_LIMIT = 2000;

const PENDING_NAMES = 10;

export function pendingPromoteWarning(
  pending: readonly (string | { id: string; platform: string })[],
  multi = false,
): string | undefined {
  if (pending.length === 0) return undefined;
  const entries: { id: string; platform?: string }[] = pending.map((entry) =>
    typeof entry === "string" ? { id: entry } : entry,
  );
  const ids = [...new Set(entries.map((entry) => entry.id))];
  const platforms = new Set(entries.flatMap((entry) => (entry.platform ? [entry.platform] : [])));
  const platformFlag = multi && platforms.size === 1 ? ` --platform ${[...platforms][0]}` : "";
  const command = `superwall promote --id ${ids.join(",")}${platformFlag}`;
  const labels = entries.map((entry) =>
    multi && entry.platform ? `${entry.id} · ${entry.platform}` : entry.id,
  );
  if (labels.length === 1) {
    return `${labels[0]} is pushed but not live — run \`${command}\` to publish it.`;
  }
  const shown = labels.slice(0, PENDING_NAMES).map((label) => `  ${label}`);
  const rest = labels.length - shown.length;
  return [
    `These ${labels.length} paywalls are pushed but not live:`,
    ...shown,
    ...(rest > 0 ? [`  …and ${rest} more`] : []),
    "",
    `  ${command}`,
  ].join("\n");
}

export function resolveNote(message: string | undefined): string | undefined {
  if (message === undefined) return undefined;
  if (message.length > NOTE_LIMIT) {
    throw new Error(`Publish note is ${message.length} characters (limit ${NOTE_LIMIT}).`);
  }
  return message;
}

export const took = (since: number): string => {
  const seconds = (Date.now() - since) / 1000;
  return pc.dim(seconds < 10 ? `(${seconds.toFixed(1)}s)` : `(${Math.round(seconds)}s)`);
};

