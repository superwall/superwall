import { ApiError } from "@/core/api/client";
import type { CommandContext } from "@/program/command";
import { approveVersion, type WorkspaceVersion } from "./api";
import { WorkspaceError, type Manifest } from "./project";
import { awaitingInstall, roleCanApprove, pickVersion, resolveWorkspace, type WorkspaceRef } from "./resolve";

export interface ApproveInput extends WorkspaceRef {
  version?: string;
  yes: boolean;
  acceptChanges: boolean;
}

export interface ManifestSide {
  scopes: readonly string[];
  backgroundScopes: readonly string[];
  egress: readonly string[];
  secrets: readonly string[];
  entrypoints: readonly string[];
  crons: readonly string[];
  events: readonly string[];
  storage: readonly string[];
  compatibility: readonly string[];
}

type Section = keyof ManifestSide;

const SECTIONS: readonly (readonly [Section, string])[] = [
  ["scopes", "Scopes"],
  ["backgroundScopes", "Background scopes"],
  ["egress", "Outside hosts"],
  ["secrets", "Secrets"],
  ["entrypoints", "Entrypoints"],
  ["crons", "Crons"],
  ["events", "Events"],
  ["storage", "Storage"],
  ["compatibility", "Compatibility"],
];

export interface SectionDiff {
  section: Section;
  title: string;
  added: string[];
  removed: string[];
}

interface FullManifest extends Manifest {
  background?: { scopes?: readonly string[] };
  egress?: readonly string[];
  secrets?: readonly { name: string; host: string; inject: string }[];
  crons?: readonly { name: string; schedule: string }[];
  events?: readonly string[];
  storage?: { sql?: boolean; kv?: boolean };
}

const quoted = (text: string): string => JSON.stringify(text);

const secretLabel = (secret: { name: string; host: string; inject: string }) =>
  `${secret.name} to ${secret.host} (${quoted(secret.inject)})`;

const metricLabel = (metric: NonNullable<Manifest["entrypoints"][number]["metric"]>): string => {
  const breakdowns = (metric.breakdowns ?? []).map((breakdown) => breakdown.key);
  const filters = (metric.filters ?? []).map(
    (filter) => `${filter.key} (${filter.values.map((option) => quoted(option.value)).join(", ")})`,
  );
  return [
    metric.value_type ?? "number",
    breakdowns.length > 0 ? `split by ${breakdowns.join(", ")}` : undefined,
    filters.length > 0 ? `filtered by ${filters.join(", ")}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
};

const entrypointLabel = (entrypoint: Manifest["entrypoints"][number]) =>
  [
    `${entrypoint.id}: ${entrypoint.slot}`,
    entrypoint.path ? `at ${entrypoint.path}` : undefined,
    quoted(entrypoint.title),
    entrypoint.metric ? `metric: ${metricLabel(entrypoint.metric)}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");

const emptySide: ManifestSide = {
  scopes: [],
  backgroundScopes: [],
  egress: [],
  secrets: [],
  entrypoints: [],
  crons: [],
  events: [],
  storage: [],
  compatibility: [],
};

export function sideOf(version: WorkspaceVersion | undefined, enforced: boolean): ManifestSide {
  const manifest = version?.manifest as FullManifest | null | undefined;
  if (!version || !manifest) return emptySide;
  if (enforced && version.grant === null) return emptySide;
  const grant = enforced ? version.grant : null;
  const storage = manifest.storage ?? {};
  return {
    scopes: grant?.scopes ?? manifest.scopes,
    backgroundScopes: grant?.background_scopes ?? manifest.background?.scopes ?? [],
    egress: grant?.egress ?? manifest.egress ?? [],
    secrets: (grant?.secret_bindings ?? manifest.secrets ?? []).map(secretLabel),
    entrypoints: manifest.entrypoints.map(entrypointLabel),
    crons: (manifest.crons ?? []).map((cron) => `${cron.name}: ${cron.schedule}`),
    events: manifest.events ?? [],
    storage: [storage.sql ? "sql" : undefined, storage.kv ? "kv" : undefined].filter((kind): kind is string => kind !== undefined),
    compatibility: [
      ...(version.compatibility_date ? [`date ${version.compatibility_date}`] : []),
      ...(version.compatibility_flags ?? []).map((flag) => `flag ${flag}`),
    ],
  };
}

export function diffSides(before: ManifestSide, after: ManifestSide): SectionDiff[] {
  return SECTIONS.flatMap(([section, title]) => {
    const [old, next] = [new Set(before[section]), new Set(after[section])];
    const added = [...next].filter((item) => !old.has(item)).sort();
    const removed = [...old].filter((item) => !next.has(item)).sort();
    return added.length + removed.length > 0 ? [{ section, title, added, removed }] : [];
  });
}

const manifestLines = (side: ManifestSide): string[] =>
  SECTIONS.flatMap(([section, title]) => {
    const items = side[section];
    if (items.length === 0) return section === "scopes" || section === "egress" ? [`${title}: none`] : [];
    return [`${title}:`, ...[...items].sort().map((item) => `  ${item}`)];
  });

const diffLines = (diff: readonly SectionDiff[]): string[] =>
  diff.flatMap(({ title, added, removed }) => [
    `${title}:`,
    ...added.map((item) => `  + ${item}`),
    ...removed.map((item) => `  - ${item}`),
  ]);

function commitLine(message: string): string {
  const [subject = "", note] = message.split(/\n\n+/);
  return subject.startsWith("push workspace/") && note && !note.startsWith("Superwall-") ? note : subject;
}

const ONLY_ADMINS =
  "Only organization owners and admins can approve workspace versions. Ask one of them to review this version.";

export async function runWorkspaceApprove(ctx: CommandContext<"required">, input: ApproveInput): Promise<void> {
  const workspace = await resolveWorkspace(ctx, input);
  const { version, versions } = await pickVersion(
    ctx,
    workspace,
    input.version,
    (candidate) => candidate.build_status === "SUCCEEDED" && candidate.id !== workspace.active_version_id,
  );
  if (version.build_status !== "SUCCEEDED" || version.manifest === null) {
    throw new WorkspaceError(`Version ${version.id} is ${version.build_status.toLowerCase()}. Only a built version can be approved.`);
  }
  if (version.id === workspace.active_version_id && version.grant !== null) {
    if (ctx.json) ctx.output.data({ approved: false, reason: "already_active", version_id: version.id });
    else ctx.ui.info(`Version ${version.id} is already live.`);
    return;
  }

  const active = versions.find((candidate) => candidate.id === workspace.active_version_id);
  const proposed = sideOf(version, false);
  const diff = diffSides(sideOf(active, true), proposed);
  const details = {
    workspace_id: workspace.id,
    version_id: version.id,
    commit_sha: version.commit_sha,
    active_version_id: active?.id ?? null,
    manifest: version.manifest,
    compatibility_date: version.compatibility_date ?? null,
    compatibility_flags: version.compatibility_flags ?? [],
    diff,
  };

  if (!ctx.json) {
    ctx.ui.report(
      [
        `${workspace.name}, version ${version.id} (${version.commit_sha.slice(0, 12)})`,
        ...(version.commit_message ? [commitLine(version.commit_message)] : []),
        "",
        "What it can do:",
        ...manifestLines(proposed),
        "",
        active ? `Changes from the live version, ${active.id}:` : "Nothing is live yet, so all of this is new:",
        ...(diff.length === 0 ? ["  Nothing it can do changes."] : diffLines(diff)),
      ].join("\n"),
    );
  }

  const refuse = (reason: string, message: string) => {
    if (ctx.json) ctx.output.data({ approved: false, reason, ...details });
    else ctx.ui.error(message);
    ctx.fail();
  };
  if (!(await roleCanApprove(ctx, workspace))) {
    refuse("needs_admin", ONLY_ADMINS);
    if (!ctx.json) ctx.ui.info("To ask for review, run `superwall workspaces share`.");
    return;
  }
  const changes = diff.length > 0;
  const accepted = !changes || input.acceptChanges;
  if (ctx.interactive && !(input.yes && accepted)) {
    const confirmed = await ctx.ui.confirm({
      message: changes
        ? `Approve version ${version.id}, with the changes above to what it can do?`
        : `Approve version ${version.id}?`,
      initial: false,
    });
    if (!confirmed) {
      ctx.ui.outro("Nothing was approved.");
      return;
    }
  } else if (!ctx.interactive) {
    if (!input.yes) {
      refuse(
        "needs_yes",
        "Nothing was approved. Read the above, then pass --yes to approve it.",
      );
      return;
    }
    if (!accepted) {
      refuse(
        "needs_accept_changes",
        "Nothing was approved, because this changes what the workspace can do. Read the changes above, then pass --accept-changes too.",
      );
      return;
    }
  }

  let approved: WorkspaceVersion;
  try {
    approved = await approveVersion(ctx.api, workspace.id, version.id);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 403) throw error;
    refuse("forbidden", error.message);
    return;
  }
  if (ctx.json) {
    ctx.output.data({ approved: true, ...details, version: approved });
    return;
  }
  ctx.ui.success(
    (await awaitingInstall(ctx.api, workspace.id, version.manifest))
      ? `Approved version ${version.id}. Nothing is installed yet, so only its author can see it until you choose where it shows.`
      : `Approved version ${version.id}. It's live for everyone it's installed for.`,
  );
  ctx.ui.info(`Choose where it shows with \`superwall workspaces install <entrypoint> --workspace ${workspace.id}\`.`);
}
