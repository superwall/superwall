import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandContext } from "@/program/command";
import { applyPulledChanges } from "@/core/paywalls/pull";
import { pullSourceTree, type PullResult } from "@/core/paywalls/source/git";
import { WORKSPACE_DERIVED_FILES } from "@/core/paywalls/source/scope";
import { collectSourceFiles } from "@/core/paywalls/source/source";
import { mintSourceAccess } from "./api";
import { readBinding, readSourceFile, writeBinding, type WorkspaceBinding } from "./binding";
import { WorkspaceError } from "./project";
import { projectRoot, resolveWorkspace } from "./resolve";
import { toSourceAccess } from "./push";

export interface WorkspacePullInput {
  dir?: string;
  workspace?: string;
  org?: string;
  theirs: boolean;
}

const NOT_PUSHED = "Its source repo is empty: nobody has pushed yet. Run `superwall workspaces push` first.";

function report(ctx: CommandContext<"required">, slug: string, head: string, written: readonly string[], skipped: readonly string[]) {
  if (ctx.json) {
    ctx.output.data({ slug, head, written, skipped });
    return;
  }
  ctx.ui.success(written.length === 0 ? "Already up to date." : `Pulled ${written.length} ${written.length === 1 ? "file" : "files"} of \`${slug}\`.`);
  if (written.length > 0) ctx.ui.list({ items: written.map((label) => ({ label })) });
  if (skipped.length > 0) {
    ctx.ui.warn(
      `Not pulled, because a file of yours that git doesn't track is in the way: ${skipped.join(", ")}. Move it, then pull again.`,
    );
  }
}

function assertCloneTarget(root: string): void {
  if (!fs.existsSync(root)) return;
  if (fs.readdirSync(root).length > 0) {
    throw new WorkspaceError(`${root} already has files and isn't linked to this workspace. Pick an empty directory.`);
  }
}

export async function runWorkspacePull(ctx: CommandContext<"required">, input: WorkspacePullInput): Promise<void> {
  const root = projectRoot(input.dir);
  const linked = readBinding(root);
  const workspace = await resolveWorkspace(ctx, input);
  if (linked && linked.workspaceId !== String(workspace.id)) {
    throw new WorkspaceError(
      `This project is linked to workspace ${linked.workspaceId}, not ${workspace.id}. Pull into an empty directory instead.`,
    );
  }
  if (!linked) assertCloneTarget(root);
  fs.mkdirSync(root, { recursive: true });

  const collected = linked ? await collectSourceFiles(root, readSourceFile) : { ok: true as const, files: [] };
  if (!collected.ok) throw new WorkspaceError(collected.reason);
  const access = toSourceAccess(await mintSourceAccess(ctx.api, workspace.id));
  const pulled: PullResult = await pullSourceTree({
    access,
    files: collected.files,
    base: linked?.syncedCommit,
    theirs: input.theirs,
    derived: WORKSPACE_DERIVED_FILES,
  });
  if (pulled.status === "empty") throw new WorkspaceError(NOT_PUSHED);

  const { written, skipped } = applyPulledChanges(
    root,
    pulled.changes,
    new Set(collected.files.map((file) => file.path)),
  );
  const binding: WorkspaceBinding = {
    workspaceId: String(workspace.id),
    organizationId: String(workspace.organization_id),
    slug: workspace.slug,
    ...(skipped.length > 0
      ? { syncedCommit: linked?.syncedCommit, reviewedCommit: linked?.reviewedCommit }
      : { syncedCommit: pulled.head, reviewedCommit: pulled.head }),
  };
  writeBinding(root, binding);
  report(ctx, workspace.slug, pulled.head, written, skipped);
  if (linked && written.length > 0 && !ctx.json) {
    ctx.ui.info("Read what came in before you push: your own copy runs all of it with your reads.");
  }
  if (!linked && !ctx.json) {
    const where = path.relative(process.cwd(), root) || ".";
    ctx.ui.info(`Next: cd ${where} && npm install && superwall workspaces dev`);
  }
}
