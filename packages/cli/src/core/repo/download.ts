import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { VERSION } from "@/environment";

const run = promisify(execFile);

export const PUBLIC_REPO = process.env.SUPERWALL_EXAMPLES_REPO ?? "superwall/superwall";
export const PUBLIC_REF = process.env.SUPERWALL_EXAMPLES_REF ?? "main";

export class RepoDownloadError extends Error {}

/** A point in the public repo to read from: a branch, or a release's tag. */
export interface RepoRef {
  kind: "branch" | "tag";
  name: string;
}

export const DEFAULT_REF: RepoRef = { kind: "branch", name: PUBLIC_REF };

/**
 * The repo as this CLI's release left it: the `v<version>` tag the release
 * workflow cuts. A released CLI reads files from it, not from `main`, so a
 * directory renamed on `main` later (workspaces/starter → artifacts/starter)
 * can't break a CLI already installed. `SUPERWALL_EXAMPLES_REF` still points
 * every download at a branch.
 */
export const releaseRef = (version: string = VERSION): RepoRef =>
  process.env.SUPERWALL_EXAMPLES_REF !== undefined
    ? DEFAULT_REF
    : { kind: "tag", name: `v${version}` };

/**
 * The refs to try, in order: this release's tag, then `main` for a build
 * whose version was never tagged (a local or unreleased build).
 */
export const releaseRefs = (version: string = VERSION): RepoRef[] => {
  const release = releaseRef(version);
  return release.kind === "tag" ? [release, DEFAULT_REF] : [release];
};

const archiveUrl = (ref: RepoRef): string =>
  `https://codeload.github.com/${PUBLIC_REPO}/tar.gz/refs/${ref.kind === "tag" ? "tags" : "heads"}/${ref.name}`;

/** GitHub names a tag's archive root without the tag's leading `v` (v2.6.0 → superwall-2.6.0). */
const archiveRoot = (ref: RepoRef): string => {
  const name = ref.kind === "tag" ? ref.name.replace(/^v(?=\d)/, "") : ref.name;
  return `${PUBLIC_REPO.split("/")[1]}-${name.replace(/\//g, "-")}`;
};

/** A single file of the repo at `ref`, as raw.githubusercontent.com serves it. */
export const rawFileUrl = (ref: RepoRef, file: string): string =>
  `https://raw.githubusercontent.com/${PUBLIC_REPO}/refs/${ref.kind === "tag" ? "tags" : "heads"}/${ref.name}/${file}`;

interface FetchResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init?: { signal: AbortSignal }) => Promise<FetchResponse>;

const DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * Extracts `dir` of the public repo into `target`. `refs` are tried in order;
 * a ref GitHub doesn't have (HTTP 404) falls through to the next. `notFound`
 * is the error when the archive downloads but has no `dir`, given the ref read.
 * Resolves to the ref the files came from.
 */
export async function downloadRepoDir(
  dir: string,
  target: string,
  notFound: string | ((ref: RepoRef) => string),
  fetchImpl: FetchLike = fetch,
  refs: RepoRef[] = [DEFAULT_REF],
): Promise<RepoRef> {
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  let response: FetchResponse | undefined;
  let ref = refs[0] ?? DEFAULT_REF;
  let bytes: ArrayBuffer;
  try {
    for (const candidate of refs.length > 0 ? refs : [DEFAULT_REF]) {
      ref = candidate;
      response = await fetchImpl(archiveUrl(ref), { signal });
      if (response.status !== 404) break;
    }
    if (response === undefined || !response.ok) {
      throw new RepoDownloadError(
        `Could not download github.com/${PUBLIC_REPO} (HTTP ${response?.status}). ` +
          "Check your network, then try again.",
      );
    }
    bytes = await response.arrayBuffer();
  } catch (error) {
    if (error instanceof RepoDownloadError) throw error;
    throw new RepoDownloadError(`Could not reach github.com/${PUBLIC_REPO}. Check your network, then try again.`);
  }

  let archive: Buffer;
  try {
    archive = gunzipSync(Buffer.from(bytes));
  } catch {
    throw new RepoDownloadError(`The download of github.com/${PUBLIC_REPO} was damaged. Try again.`);
  }
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-download-"));
  const tarball = path.join(stage, "repo.tar");
  fs.writeFileSync(tarball, archive);
  const prefix = archiveRoot(ref);
  fs.mkdirSync(target, { recursive: true });
  try {
    await run("tar", [
      "-xf",
      tarball,
      "-C",
      target,
      "--strip-components",
      String(dir.split("/").length + 1),
      `${prefix}/${dir}`,
    ]);
  } catch {
    throw new RepoDownloadError(typeof notFound === "string" ? notFound : notFound(ref));
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  return ref;
}
