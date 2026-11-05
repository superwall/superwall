import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

const run = promisify(execFile);

export const PUBLIC_REPO = process.env.SUPERWALL_EXAMPLES_REPO ?? "superwall/superwall";
export const PUBLIC_REF = process.env.SUPERWALL_EXAMPLES_REF ?? "main";

export class RepoDownloadError extends Error {}

interface FetchResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string) => Promise<FetchResponse>;

export async function downloadRepoDir(
  dir: string,
  target: string,
  notFound: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const response = await fetchImpl(
    `https://codeload.github.com/${PUBLIC_REPO}/tar.gz/refs/heads/${PUBLIC_REF}`,
  );
  if (!response.ok) {
    throw new RepoDownloadError(
      `Could not download github.com/${PUBLIC_REPO} (HTTP ${response.status}). ` +
        "Check your network, then try again.",
    );
  }

  let archive: Buffer;
  try {
    archive = gunzipSync(Buffer.from(await response.arrayBuffer()));
  } catch {
    throw new RepoDownloadError(`The download of github.com/${PUBLIC_REPO} was damaged. Try again.`);
  }
  const tarball = path.join(os.tmpdir(), `superwall-example-${process.pid}.tar`);
  fs.writeFileSync(tarball, archive);
  const prefix = `${PUBLIC_REPO.split("/")[1]}-${PUBLIC_REF.replace(/\//g, "-")}`;
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
    throw new RepoDownloadError(notFound);
  } finally {
    fs.rmSync(tarball, { force: true });
  }
}
