import { setTimeout } from "node:timers/promises";
import { ApiError, ApiUnreachableError, type SuperwallApi } from "@/core/api/client";
import { linkSourceCommit, mintSourceAccess } from "@/core/api/resources";
import { readSourceBase, writeSourceBase } from "./base";
import { gitAvailable, pushSourceTree, type DirectPushResult, type SourceAccess } from "./git";
import type { CommitMessageInput } from "./commit";
import type { SourceFile } from "./source";

export interface SourcePushInput {
  api: SuperwallApi;
  superwallDir: string;
  paywallId: string;
  applicationId: string;
  version: number;
  files: readonly SourceFile[];
  framework: string;
  surface: string;
  kind: "paywall" | "funnel";
  snapshotId?: string;
  cli?: string;
  note?: string;
  external?: readonly string[];
  overwrite?: boolean;
}

export class GitRequiredError extends Error {
  constructor() {
    super("superwall publish requires git for the source step — install git");
  }
}

export async function assertGit(hasGit: () => Promise<boolean> = gitAvailable): Promise<void> {
  if (!(await hasGit())) throw new GitRequiredError();
}

async function syncSource(
  input: Pick<SourcePushInput, "api" | "superwallDir" | "paywallId" | "files" | "overwrite">,
  message: CommitMessageInput,
): Promise<{ access: SourceAccess; pushed: DirectPushResult }> {
  const access = await mintSourceAccess(input.api, input.paywallId);
  const pushed = await pushSourceTree({
    access,
    base: readSourceBase(input.superwallDir, access.repo),
    overwrite: input.overwrite,
    files: input.files,
    message,
  });
  if (pushed.syncedTo) writeSourceBase(input.superwallDir, access.repo, pushed.syncedTo);
  return { access, pushed };
}

export async function pushSource(input: SourcePushInput): Promise<DirectPushResult> {
  for (let attempt = 0; ; attempt++) {
    const { access, pushed } = await syncSource(input, {
      kind: input.kind,
      surface: input.surface,
      version: input.version,
      paywallId: input.paywallId,
      applicationId: input.applicationId,
      snapshotSha: input.snapshotId,
      framework: input.framework,
      cli: input.cli,
      note: input.note,
      external: input.external,
    });

    try {
      await linkCommit(input, access, pushed.commitSha);
      return pushed;
    } catch (error) {
      if (attempt === 0 && error instanceof ApiError && error.status === 409) continue;
      throw error;
    }
  }
}

export interface ProjectSourcePushInput {
  api: SuperwallApi;
  superwallDir: string;
  paywallId: string;
  applicationId: string;
  files: readonly SourceFile[];
  framework: string;
  cli?: string;
  note?: string;
  overwrite?: boolean;
}

export async function pushProjectSource(input: ProjectSourcePushInput): Promise<DirectPushResult> {
  const { pushed } = await syncSource(input, {
    kind: "project",
    applicationId: input.applicationId,
    framework: input.framework,
    cli: input.cli,
    note: input.note,
  });
  return pushed;
}

const LINK_ATTEMPTS = 2;
const LINK_RETRY_DELAY_MS = 300;

async function linkCommit(input: SourcePushInput, access: SourceAccess, commitSha: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await linkSourceCommit(input.api, input.paywallId, input.version, {
        commitSha,
        tokenId: access.tokenId,
      });
      return;
    } catch (error) {
      if (attempt >= LINK_ATTEMPTS || !isTransient(error)) throw error;
      await setTimeout(LINK_RETRY_DELAY_MS);
    }
  }
}

const isTransient = (error: unknown): boolean =>
  error instanceof ApiUnreachableError || (error instanceof ApiError && error.status >= 500);
