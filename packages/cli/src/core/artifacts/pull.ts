import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandContext } from "@/program/command";
import { applyPulledChanges } from "@/core/paywalls/pull";
import { pullSourceTree, type PullResult } from "@/core/paywalls/source/git";
import { ARTIFACT_DERIVED_FILES } from "@/core/paywalls/source/scope";
import { collectSourceFiles } from "@/core/paywalls/source/source";
import { mintSourceAccess } from "./api";
import { readBinding, readSourceFile, writeBinding, type ArtifactBinding } from "./binding";
import { ArtifactError } from "./project";
import { projectRoot, resolveArtifact } from "./resolve";
import { toSourceAccess } from "./push";

export interface ArtifactPullInput {
  dir?: string;
  artifact?: string;
  org?: string;
  theirs: boolean;
}

const NOT_PUSHED = "Its source repo is empty: nobody has pushed yet. Run `superwall artifacts push` first.";

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
    throw new ArtifactError(`${root} already has files and isn't linked to this artifact. Pick an empty directory.`);
  }
}

export async function runArtifactPull(ctx: CommandContext<"required">, input: ArtifactPullInput): Promise<void> {
  const root = projectRoot(input.dir);
  const linked = readBinding(root);
  const artifact = await resolveArtifact(ctx, input);
  if (linked && linked.artifactId !== String(artifact.id)) {
    throw new ArtifactError(
      `This project is linked to artifact ${linked.artifactId}, not ${artifact.id}. Pull into an empty directory instead.`,
    );
  }
  if (!linked) assertCloneTarget(root);
  fs.mkdirSync(root, { recursive: true });

  const collected = linked ? await collectSourceFiles(root, readSourceFile) : { ok: true as const, files: [] };
  if (!collected.ok) throw new ArtifactError(collected.reason);
  const access = toSourceAccess(await mintSourceAccess(ctx.api, artifact.id));
  const pulled: PullResult = await pullSourceTree({
    access,
    files: collected.files,
    base: linked?.syncedCommit,
    theirs: input.theirs,
    derived: ARTIFACT_DERIVED_FILES,
  });
  if (pulled.status === "empty") throw new ArtifactError(NOT_PUSHED);

  const { written, skipped } = applyPulledChanges(
    root,
    pulled.changes,
    new Set(collected.files.map((file) => file.path)),
  );
  const binding: ArtifactBinding = {
    artifactId: String(artifact.id),
    organizationId: String(artifact.organization_id),
    slug: artifact.slug,
    ...(skipped.length > 0
      ? { syncedCommit: linked?.syncedCommit, reviewedCommit: linked?.reviewedCommit }
      : { syncedCommit: pulled.head, reviewedCommit: pulled.head }),
  };
  writeBinding(root, binding);
  report(ctx, artifact.slug, pulled.head, written, skipped);
  if (linked && written.length > 0 && !ctx.json) {
    ctx.ui.info("Read what came in before you push: your own copy runs all of it with your reads.");
  }
  if (!linked && !ctx.json) {
    const where = path.relative(process.cwd(), root) || ".";
    ctx.ui.info(`Next: cd ${where} && npm install && superwall artifacts dev`);
  }
}
