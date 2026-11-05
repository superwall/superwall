import * as fs from "node:fs";
import * as path from "node:path";
import { WORKSPACE_FILE } from "@/core/paywalls/source/scope";
import { WorkspaceError } from "./project";

export interface WorkspaceBinding {
  workspaceId: string;
  organizationId: string;
  slug: string;
  syncedCommit?: string;
}

export function readBinding(root: string): WorkspaceBinding | undefined {
  const file = path.join(root, WORKSPACE_FILE);
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
    throw new WorkspaceError(`${WORKSPACE_FILE} is not valid JSON: ${(error as Error).message}`);
  }
  const { workspace_id: workspaceId, organization_id: organizationId, slug, synced_commit: syncedCommit } = parsed;
  if (typeof workspaceId !== "number" || typeof organizationId !== "number" || typeof slug !== "string") {
    throw new WorkspaceError(`${WORKSPACE_FILE} needs workspace_id, organization_id and slug.`);
  }
  return {
    workspaceId: String(workspaceId),
    organizationId: String(organizationId),
    slug,
    ...(typeof syncedCommit === "string" ? { syncedCommit } : {}),
  };
}

const formatBinding = (binding: WorkspaceBinding, includeSync: boolean): string =>
  `${JSON.stringify(
    {
      workspace_id: Number(binding.workspaceId),
      organization_id: Number(binding.organizationId),
      slug: binding.slug,
      ...(includeSync && binding.syncedCommit ? { synced_commit: binding.syncedCommit } : {}),
    },
    null,
    2,
  )}\n`;

export function writeBinding(root: string, binding: WorkspaceBinding): void {
  fs.writeFileSync(path.join(root, WORKSPACE_FILE), formatBinding(binding, true));
}

export function readSourceFile(root: string, relative: string): Buffer {
  const file = path.join(root, relative);
  if (relative !== WORKSPACE_FILE) return fs.readFileSync(file);
  const binding = readBinding(root);
  return binding ? Buffer.from(formatBinding(binding, false)) : fs.readFileSync(file);
}
