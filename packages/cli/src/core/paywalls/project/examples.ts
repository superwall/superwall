import * as fs from "node:fs";
import * as path from "node:path";
import { field } from "@/core/json";
import {
  downloadRepoDir,
  PUBLIC_REF as EXAMPLES_REF,
  PUBLIC_REPO as EXAMPLES_REPO,
  RepoDownloadError as ExampleError,
  type FetchLike,
} from "@/core/repo/download";

export { EXAMPLES_REPO, ExampleError, type FetchLike };

export async function listExamples(fetchImpl: FetchLike = fetch): Promise<string[]> {
  const response = await fetchImpl(
    `https://api.github.com/repos/${EXAMPLES_REPO}/contents/examples?ref=${EXAMPLES_REF}`,
  );
  if (!response.ok) {
    throw new ExampleError(
      `Could not list examples from github.com/${EXAMPLES_REPO} (HTTP ${response.status}).`,
    );
  }
  const entries: unknown = await response.json();
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => field(entry, "type") === "dir")
    .map((entry) => field(entry, "name"))
    .filter((name): name is string => typeof name === "string")
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

  await downloadRepoDir(
    `examples/${name}`,
    target,
    `No example named \`${name}\` in github.com/${EXAMPLES_REPO} — ` +
      "run `superwall create` without --example to pick from the list.",
    fetchImpl,
  );

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
