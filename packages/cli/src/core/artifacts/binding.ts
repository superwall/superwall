import * as fs from "node:fs";
import * as path from "node:path";
import { ARTIFACT_FILE } from "@/core/paywalls/source/scope";
import { ArtifactError } from "./project";

export interface ArtifactBinding {
  artifactId: string;
  organizationId: string;
  slug: string;
  syncedCommit?: string;
  reviewedCommit?: string;
}

export function readBinding(root: string): ArtifactBinding | undefined {
  const file = path.join(root, ARTIFACT_FILE);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new ArtifactError(`${ARTIFACT_FILE} is not valid JSON: ${(error as Error).message}`);
  }
  const {
    artifact_id: artifactId,
    organization_id: organizationId,
    slug,
    synced_commit: syncedCommit,
    reviewed_commit: reviewedCommit,
  } = parsed;
  if (typeof artifactId !== "number" || typeof organizationId !== "number" || typeof slug !== "string") {
    throw new ArtifactError(`${ARTIFACT_FILE} needs artifact_id, organization_id and slug.`);
  }
  return {
    artifactId: String(artifactId),
    organizationId: String(organizationId),
    slug,
    ...(typeof syncedCommit === "string" ? { syncedCommit } : {}),
    ...(typeof reviewedCommit === "string" ? { reviewedCommit } : {}),
  };
}

const formatBinding = (binding: ArtifactBinding, includeSync: boolean): string =>
  `${JSON.stringify(
    {
      artifact_id: Number(binding.artifactId),
      organization_id: Number(binding.organizationId),
      slug: binding.slug,
      ...(includeSync && binding.syncedCommit ? { synced_commit: binding.syncedCommit } : {}),
      ...(includeSync && binding.reviewedCommit ? { reviewed_commit: binding.reviewedCommit } : {}),
    },
    null,
    2,
  )}\n`;

export function writeBinding(root: string, binding: ArtifactBinding): void {
  fs.writeFileSync(path.join(root, ARTIFACT_FILE), formatBinding(binding, true));
}

export function readSourceFile(root: string, relative: string): Buffer {
  const file = path.join(root, relative);
  if (relative !== ARTIFACT_FILE) return fs.readFileSync(file);
  const binding = readBinding(root);
  return binding ? Buffer.from(formatBinding(binding, false)) : fs.readFileSync(file);
}
