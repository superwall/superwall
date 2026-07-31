import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const EXAMPLES_REPO = process.env.SUPERWALL_EXAMPLES_REPO ?? "superwall/superwall";
export const EXAMPLES_REF = process.env.SUPERWALL_EXAMPLES_REF ?? "main";

export class ExampleError extends Error {}

export interface FetchResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string) => Promise<FetchResponse>;

export async function listExamples(fetchImpl: FetchLike = fetch): Promise<string[]> {
  const response = await fetchImpl(
    `https://api.github.com/repos/${EXAMPLES_REPO}/contents/examples?ref=${EXAMPLES_REF}`,
  );
  if (!response.ok) {
    throw new ExampleError(
      `Could not list examples from github.com/${EXAMPLES_REPO} (HTTP ${response.status}).`,
    );
  }
  const entries = (await response.json()) as Array<{ name?: string; type?: string }>;
  return entries
    .filter((entry) => entry.type === "dir" && typeof entry.name === "string")
    .map((entry) => entry.name as string)
    .sort();
}

export async function downloadExample(
  name: string,
  target: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new ExampleError(`\`${name}\` is not an example name.`);
  }

  const response = await fetchImpl(
    `https://codeload.github.com/${EXAMPLES_REPO}/tar.gz/refs/heads/${EXAMPLES_REF}`,
  );
  if (!response.ok) {
    throw new ExampleError(
      `Could not download github.com/${EXAMPLES_REPO} (HTTP ${response.status}). ` +
        "Check your network, then try again.",
    );
  }

  const tarball = path.join(os.tmpdir(), `superwall-example-${process.pid}.tar.gz`);
  fs.writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
  const prefix = `${EXAMPLES_REPO.split("/")[1]}-${EXAMPLES_REF.replace(/\//g, "-")}`;
  fs.mkdirSync(target, { recursive: true });
  try {
    await run("tar", [
      "-xzf",
      tarball,
      "-C",
      target,
      "--strip-components",
      "3",
      `${prefix}/examples/${name}`,
    ]);
  } catch {
    throw new ExampleError(
      `No example named \`${name}\` in github.com/${EXAMPLES_REPO} — ` +
        "run `superwall create` without --example to pick from the list.",
    );
  } finally {
    fs.rmSync(tarball, { force: true });
  }

  if (!fs.existsSync(path.join(target, "package.json"))) {
    throw new ExampleError(`Example \`${name}\` did not contain a project.`);
  }
}

export function adoptExamplePackage(target: string, name: string): void {
  const file = path.join(target, "package.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
    name?: string;
    dependencies?: Record<string, string>;
  };
  parsed.name = name;
  if (parsed.dependencies?.superwall !== undefined) parsed.dependencies.superwall = "latest";
  fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
}
