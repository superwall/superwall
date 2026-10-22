import type { CommandContext } from "@/program/command";
import { listAscConfigs, removeAscConfig } from "@/core/app-store-connect/api/client";
import { resolveAscOrgApi } from "@/core/app-store-connect/api/request";
import {
  listKeySources,
  copyAppKey,
  importAppKey,
  type AppKeyKind,
  type KeyImportResult,
  findIntegrations,
  removeAppKey,
} from "@/core/api/integrations";
import { rowName } from "@/core/api/resources";
import { chooseKeyApp, savedKey } from "@/core/app-store-connect/keys/app";
import { KEY_KINDS, KEY_LABEL, keyKind } from "@/core/api/integrations";
import { upsertHeldKey } from "@/core/app-store-connect/keys/held";
import type { AppFlags } from "@/core/app-store-connect/superwall-app";
import { apiCall } from "@/ui/spinner";

export async function removeFromApp(ctx: CommandContext<"required">, key: string | undefined, flags: AppFlags): Promise<void> {
  const kind = keyKind(key);
  if (!kind) throw new Error("Usage: superwall asc keys delete <api_key | purchase_key> --app <id>");
  const { app, name } = await chooseKeyApp(ctx, flags);
  if (ctx.dryRun) {
    if (ctx.json) return ctx.output.data({ dryRun: true, action: "delete", kind, application_id: app.applicationId });
    ctx.ui.info(`[dry-run] would remove the ${KEY_LABEL[kind]} from ${name}`);
    return;
  }
  await apiCall(ctx, "Removing the key", () => removeAppKey(ctx.api, app.applicationId, kind));
  if (ctx.json) return ctx.output.data({ deleted: true, kind, application_id: app.applicationId });
  ctx.ui.success(
    `Removed the ${KEY_LABEL[kind]} from \`${name}\`. Nothing was revoked at Apple, and your organization's copy is kept.`,
  );
}

export async function removeFromOrganization(ctx: CommandContext<"required">, teamId: string | undefined): Promise<void> {
  if (!teamId) throw new Error("Usage: superwall asc keys delete <team_id>");
  if (keyKind(teamId)) {
    throw new Error(`Usage: superwall asc keys delete ${teamId} --app <id>`);
  }
  if (ctx.dryRun) {
    if (ctx.json) return ctx.output.data({ dryRun: true, action: "delete", teamId });
    ctx.ui.info(`[dry-run] would delete ASC credential ${teamId}`);
    return;
  }
  const api = await resolveAscOrgApi(ctx);
  await apiCall(ctx, "Removing credential", () => removeAscConfig(api, teamId));
  if (ctx.json) return ctx.output.data({ deleted: true, teamId });
  ctx.ui.success(`Removed App Store Connect credential ${teamId}`);
}

export async function listAppKeys(ctx: CommandContext<"required">, flags: AppFlags): Promise<void> {
  const { app, name } = await chooseKeyApp(ctx, flags);
  const saved = await apiCall(ctx, "Loading keys", () => findIntegrations(ctx.api, app.applicationId));
  const keys = Object.fromEntries(
    KEY_KINDS.map((kind) => {
      const key = savedKey(saved, kind);
      return [
        kind,
        key ? { key_id: key.key_id, issuer_id: key.issuer_id, ...(key.bundle_id ? { bundle_id: key.bundle_id } : {}) } : null,
      ];
    }),
  );
  if (ctx.json) return ctx.output.data({ application_id: app.applicationId, ...keys });
  ctx.ui.step(`Apple keys saved on \`${name}\``);
  ctx.ui.report(
    KEY_KINDS.map((kind) => {
      const key = savedKey(saved, kind);
      return `${key ? "✓" : "✗"} ${KEY_LABEL[kind]}  ${key ? key.key_id : "not saved"}`;
    }).join("\n"),
  );
}

export async function listOrganizationKeys(ctx: CommandContext<"required">): Promise<void> {
  const api = await resolveAscOrgApi(ctx);
  const configs = await apiCall(ctx, "Loading credentials", () => listAscConfigs(api));
  if (ctx.json) return ctx.output.data(configs);

  if (configs.length === 0) {
    ctx.ui.step("No App Store Connect credentials yet");
    if (ctx.interactive) {
      const add = await ctx.ui.confirm({ message: "Connect an App Store Connect key now?" });
      if (add) return upsertHeldKey(ctx, { action: "create", key: {}, orgApi: api });
      return;
    }
    ctx.ui.info("Add one: superwall asc keys create --key-id <id> --issuer <id> --key-file <path.p8>");
    return;
  }

  ctx.ui.step(`${configs.length} App Store Connect credential${configs.length === 1 ? "" : "s"}`);
  for (const c of configs) ctx.ui.info(`\`${rowName(c)}\`  ${c.team_id ?? c.id ?? ""}`);
}

function describeImport(result: KeyImportResult, name: string): string {
  const label = KEY_LABEL[result.kind];
  if (result.status === "imported") {
    return `${label} ${result.key_id ?? ""} imported to ${name}${result.source_name ? ` from ${result.source_name}` : ""}.`;
  }
  if (result.status === "already_saved") {
    return `${name} already has an ${label}${result.key_id ? ` (${result.key_id})` : ""}. It was left as it is.`;
  }
  if (result.timed_out) {
    return `No ${label} confirmed for ${name} before the search ran out of time (${result.tried} tried). Run it again.`;
  }
  return result.tried === 0
    ? `Your organization has no ${label} to try on ${name}.`
    : `None of your organization's ${result.tried} saved ${label}s is confirmed by Apple for ${name}.`;
}

export async function importKeys(ctx: CommandContext<"required">, one: AppKeyKind | undefined, flags: AppFlags): Promise<void> {
  const kinds = one ? [one] : KEY_KINDS;
  const { app, name } = await chooseKeyApp(ctx, flags);
  if (ctx.dryRun) {
    if (ctx.json) return ctx.output.data({ dryRun: true, action: "import", kinds, application_id: app.applicationId });
    ctx.ui.info(`[dry-run] would try your organization's saved keys on ${name}`);
    return;
  }
  const results: KeyImportResult[] = [];
  for (const kind of kinds) {
    results.push(
      await apiCall(ctx, `Trying your organization's ${KEY_LABEL[kind]}s`, () => {
        return importAppKey(ctx.api, app.applicationId, kind);
      }),
    );
  }
  const missing = results.some((result) => result.status === "not_found");
  if (missing) ctx.fail();
  if (ctx.json) {
    return ctx.output.data({
      application_id: app.applicationId,
      results: results.map((result) => ({
        kind: result.kind,
        status: result.status,
        key_id: result.key_id,
        source_name: result.source_name,
        source_application_id: result.source_application_id,
        tried: result.tried,
        timed_out: result.timed_out,
      })),
    });
  }
  ctx.ui.report(
    results.map((result) => `${result.status === "not_found" ? "✗" : "✓"} ${describeImport(result, name)}`).join("\n"),
  );
}

export async function copyKey(
  ctx: CommandContext<"required">,
  kind: AppKeyKind | undefined,
  from: string,
  allowUnconfirmed: boolean,
  flags: AppFlags,
): Promise<void> {
  if (!kind) throw new Error("Usage: superwall asc keys import <api_key | purchase_key> --app <id>");
  const { app, name } = await chooseKeyApp(ctx, flags);
  if (ctx.dryRun) {
    if (ctx.json) return ctx.output.data({ dryRun: true, action: "import", kind, application_id: app.applicationId, from });
    ctx.ui.info(`[dry-run] would copy the ${KEY_LABEL[kind]} from app ${from} to ${name}`);
    return;
  }
  const copy = (confirmed: boolean) => {
    return apiCall(ctx, `Copying the ${KEY_LABEL[kind]}`, () => {
      return copyAppKey(ctx.api, app.applicationId, { kind, from, confirmed });
    });
  };
  let result = await copy(allowUnconfirmed);
  if (!result.valid && result.unconfirmed && ctx.interactive) {
    ctx.ui.warn(result.unconfirmed);
    const save = await ctx.ui.confirm({ message: "Save this key anyway?" });
    if (save) result = await copy(true);
  }
  if (ctx.json) {
    ctx.output.data({
      application_id: app.applicationId,
      kind,
      from,
      valid: result.valid,
      error: result.error,
      unconfirmed: result.unconfirmed,
    });
  } else if (result.valid) {
    ctx.ui.success(`${KEY_LABEL[kind]} copied to \`${name}\`.`);
  } else if (result.unconfirmed) {
    ctx.ui.error(
      `${result.unconfirmed}\nNothing was saved. Pass --allow-unconfirmed to save it anyway, once a person has confirmed it is the right team's key.`,
    );
  } else {
    ctx.ui.error(`${result.error ?? "The key wasn't copied."}\nNothing was saved.`);
  }
  if (!result.valid) ctx.fail();
}

interface AscKeysSourcesInput {
  flags: { app: string | undefined; project: string | undefined; };
}

export async function runAscKeysSources(ctx: CommandContext<"required">, { flags }: AscKeysSourcesInput): Promise<void> {
  const { app, name } = await chooseKeyApp(ctx, { app: flags.app, project: flags.project });
  const sources = await apiCall(ctx, "Loading keys on your other apps", () => {
    return listKeySources(ctx.api, app.applicationId);
  });
  if (ctx.json) {
    return ctx.output.data({
      application_id: app.applicationId,
      api_key: sources.api_key,
      purchase_key: sources.purchase_key,
    });
  }
  const total = sources.api_key.length + sources.purchase_key.length;
  if (total === 0) {
    ctx.ui.step(`No other app has a key \`${name}\` could use`);
    return;
  }
  ctx.ui.step(`${total} key${total === 1 ? "" : "s"} on your other apps`);
  for (const kind of KEY_KINDS) {
    for (const source of sources[kind]) {
      const more = source.others_count > 0 ? ` and ${source.others_count} more` : "";
      ctx.ui.info(`\`${source.key_id}\`  ${KEY_LABEL[kind]}  from ${source.name}${more} (app ${source.application_id})`);
    }
  }
}
