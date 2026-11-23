import type { CommandContext } from "@/program/command";
import type { AppRef } from "@/core/app-store-connect/api/client";
import type { AppKeyKind, SavedAppKey } from "@/core/api/integrations";
import { orgIdOf } from "@/core/api/orgs";
import { chooseIosApp, savedBundleId, type AppFlags } from "../superwall-app";

export interface KeyApp {
  app: AppRef;
  name: string;
  savedBundleId: string | null;
  organizationId: string | undefined;
}

export async function chooseKeyApp(ctx: CommandContext<"required">, flags: AppFlags): Promise<KeyApp> {
  const chosen = await chooseIosApp(ctx, ctx.api, flags);
  return {
    app: { projectId: String(chosen.project.id), applicationId: String(chosen.app.id) },
    name: chosen.app.name ?? String(chosen.app.id),
    savedBundleId: savedBundleId(chosen.app),
    organizationId: orgIdOf(chosen.project),
  };
}

export const savedKey = (
  saved: { app_store_connect_configuration: SavedAppKey | null; in_app_purchase_configuration: SavedAppKey | null },
  kind: AppKeyKind,
): SavedAppKey | undefined =>
  (kind === "api_key" ? saved.app_store_connect_configuration : saved.in_app_purchase_configuration) ??
  undefined;

