import * as fs from "node:fs";
import * as path from "node:path";

export class ArtifactError extends Error {}

export interface MetricFilter {
  key: string;
  name: string;
  values: readonly { value: string; label: string }[];
}

export interface MetricDefinition {
  description?: string;
  value_type?: string;
  breakdowns?: readonly { key: string; name: string }[];
  filters?: readonly MetricFilter[];
}

export interface Entrypoint {
  id: string;
  slot: string;
  title: string;
  path?: string;
  metric?: MetricDefinition;
}

export interface Manifest {
  name: string;
  client?: { entry: string };
  scopes: readonly string[];
  entrypoints: readonly Entrypoint[];
}

export interface ArtifactProject {
  root: string;
  manifest: Manifest;
}

export const MANIFEST_FILE = "superwall.json";
export const VENDORED_SDK = path.join("vendor", "artifact-sdk");

function isManifest(value: unknown): value is Manifest {
  if (typeof value !== "object" || value === null) return false;
  const { name, scopes, entrypoints } = value as Record<string, unknown>;
  return typeof name === "string" && Array.isArray(scopes) && Array.isArray(entrypoints);
}

export function readManifest(root: string): Manifest {
  const file = path.join(root, MANIFEST_FILE);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new ArtifactError(
      `No ${MANIFEST_FILE} in ${root}. Run this inside an artifact, or start one with \`superwall artifacts create\`.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ArtifactError(`${MANIFEST_FILE} is not valid JSON: ${(error as Error).message}`);
  }
  if (!isManifest(parsed)) {
    throw new ArtifactError(`${MANIFEST_FILE} needs a name, scopes and entrypoints.`);
  }
  return parsed;
}

export function readProject(dir: string | undefined): ArtifactProject {
  const root = path.resolve(dir ?? process.cwd());
  return { root, manifest: readManifest(root) };
}

export function findEntrypoint(manifest: Manifest, id: string): Entrypoint {
  const entrypoint = manifest.entrypoints.find((candidate) => candidate.id === id);
  if (entrypoint) return entrypoint;
  const known = manifest.entrypoints.map((candidate) => candidate.id).join(", ") || "none";
  throw new ArtifactError(`No entrypoint named \`${id}\` in ${MANIFEST_FILE}. It has: ${known}.`);
}

export function bundleDir(root: string): string {
  return path.join(root, ".superwall", "artifact");
}
