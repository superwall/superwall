import { ApiError, type SuperwallApi } from "@/core/api/client";
import { linkSourceCommit, mintSourceAccess } from "@/core/api/resources";
import { readSourceBase, writeSourceBase } from "./base";
import { gitAvailable, pushSourceTree, type DirectPushResult } from "./git";
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
  hasGit?: () => Promise<boolean>;
}

export class GitRequiredError extends Error {
  constructor() {
    super("superwall publish requires git for the source step — install git");
  }
}

export async function pushSource(input: SourcePushInput): Promise<DirectPushResult> {
  if (!(await (input.hasGit ?? gitAvailable)())) throw new GitRequiredError();

  for (let attempt = 0; ; attempt++) {
    const access = await mintSourceAccess(input.api, input.paywallId);
    const pushed = await pushSourceTree({
      access,
      base: readSourceBase(input.superwallDir, access.repo),
      files: input.files,
      message: {
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
      },
    });

    try {
      await linkSourceCommit(input.api, input.paywallId, input.version, {
        commitSha: pushed.commitSha,
        tokenId: access.tokenId,
      });
      if (pushed.syncedTo) writeSourceBase(input.superwallDir, access.repo, pushed.syncedTo);
      return pushed;
    } catch (error) {
      if (attempt === 0 && worthRetrying(error)) continue;
      throw error;
    }
  }
}

const worthRetrying = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 409 || error.status === 400);
