import { readFileSync } from "node:fs";
import type { CommandContext } from "@/command";
import { saveAppAscKey, saveAppPurchaseKey, type AppRef } from "@/core/api/asc";
import {
  copyAppKey,
  getIntegrations,
  importAppKey,
  listKeySources,
  removeAppKey,
  type AppKeyKind,
  type KeyImportResult,
} from "@/core/api/integrations";
import { apiCall, emitJson } from "@/commands/api-output";
import { testModeWarning } from "@/commands/resource/bundle-id";
import { chooseIosApp, differentBundleId, savedBundleId } from "./apple-app";
import { appFlags, KEY_KINDS, KEY_LABEL, keyKind, savedKey, text } from "./apple-keys";
import type { KeyInput } from "./keys";

interface AppKeyContext {
  ctx: CommandContext<"required">;
  app: AppRef;
  name: string;
  savedBundleId: string | null;
}

async function target(ctx: CommandContext<"required">): Promise<AppKeyContext> {
  const chosen = await chooseIosApp(ctx, ctx.api, appFlags(ctx));
  return {
    ctx,
    app: { projectId: String(chosen.project.id), applicationId: String(chosen.app.id) },
    name: chosen.app.name ?? String(chosen.app.id),
    savedBundleId: savedBundleId(chosen.app),
  };
}

function purchaseKeyBundleId(
  ctx: CommandContext,
  { app, name, savedBundleId: saved }: AppKeyContext,
): { bundleId: string; setApplicationBundleId: boolean } {
  const wanted = text(ctx, "bundle-id");
  if (!wanted) {
    if (saved) return { bundleId: saved, setApplicationBundleId: false };
    throw new Error(
      `\`${name}\` has no bundle ID in Superwall. Pass --bundle-id <id> to save it with the key, or set it first with \`superwall apps bundle-id <id> --app ${app.applicationId}\`.`,
    );
  }
  if (saved && saved !== wanted) {
    throw new Error(differentBundleId(name, app.applicationId, saved, wanted));
  }
  return { bundleId: wanted, setApplicationBundleId: saved === null };
}

function requireKind(ctx: CommandContext, action: string): AppKeyKind {
  const kind = keyKind(ctx.argv.value2);
  if (!kind) {
    throw new Error(`Usage: superwall asc keys ${action} <api_key | purchase_key> --app <id>`);
  }
  return kind;
}

export async function listAppKeys(ctx: CommandContext<"required">): Promise<void> {
  const { app, name } = await target(ctx);
  const saved = await apiCall(ctx, "Loading keys", () => getIntegrations(ctx.api, app.applicationId));
  const keys = Object.fromEntries(
    KEY_KINDS.map((kind) => {
      const key = savedKey(saved, kind);
      return [
        kind,
        key
          ? { key_id: key.key_id, issuer_id: key.issuer_id, ...(key.bundle_id ? { bundle_id: key.bundle_id } : {}) }
          : null,
      ];
    }),
  );
  if (ctx.json) return emitJson(ctx, { application_id: app.applicationId, ...keys });
  ctx.ui.step(`Apple keys saved on \`${name}\``);
  ctx.ui.report(
    KEY_KINDS.map((kind) => {
      const key = savedKey(saved, kind);
      return `${key ? "✓" : "✗"} ${KEY_LABEL[kind]}  ${key ? key.key_id : "not saved"}`;
    }).join("\n"),
  );
}

export async function setAppKey(ctx: CommandContext<"required">, input: KeyInput): Promise<void> {
  const kind = ctx.argv.value2 === undefined ? "api_key" : requireKind(ctx, "set");
  const chosen = await target(ctx);
  const { app, name } = chosen;
  const bundle = kind === "purchase_key" ? purchaseKeyBundleId(ctx, chosen) : undefined;
  if (ctx.dryRun) {
    const plan = {
      dryRun: true,
      action: "set",
      kind,
      application_id: app.applicationId,
      keyId: input.keyId,
      ...(bundle ? { bundle_id: bundle.bundleId, set_application_bundle_id: bundle.setApplicationBundleId } : {}),
    };
    const alsoBundle = bundle?.setApplicationBundleId ? ` and its bundle ID ${bundle.bundleId}` : "";
    return void (ctx.json
      ? emitJson(ctx, plan)
      : ctx.ui.info(`[dry-run] would save ${KEY_LABEL[kind]} ${input.keyId}${alsoBundle} on ${name}`));
  }
  if (bundle?.setApplicationBundleId) {
    const warning = await testModeWarning(ctx, ctx.api, app.applicationId, bundle.bundleId);
    if (warning) ctx.ui.warn(warning);
  }
  const credentials = {
    keyId: input.keyId,
    issuerId: input.issuerId,
    privateKey: readFileSync(input.keyFile, "utf8"),
  };
  const verdict = await apiCall(ctx, `Saving the ${KEY_LABEL[kind]}`, () =>
    kind === "api_key"
      ? saveAppAscKey(ctx.api, app, credentials)
      : saveAppPurchaseKey(ctx.api, app, { ...credentials, ...bundle! }),
  );
  if (ctx.json) {
    emitJson(ctx, {
      application_id: app.applicationId,
      kind,
      key_id: input.keyId,
      ...verdict,
      ...(bundle ? { bundle_id: bundle.bundleId, bundle_id_saved: verdict.valid && bundle.setApplicationBundleId } : {}),
    });
  } else if (verdict.valid) {
    ctx.ui.success(
      bundle?.setApplicationBundleId
        ? `${KEY_LABEL[kind]} ${input.keyId} and the bundle ID ${bundle.bundleId} saved on \`${name}\`.`
        : `${KEY_LABEL[kind]} ${input.keyId} saved on \`${name}\`.`,
    );
  } else {
    ctx.ui.error(
      `Apple didn't accept ${KEY_LABEL[kind]} ${input.keyId}${verdict.error ? `: ${verdict.error}` : "."}`,
    );
  }
  if (!verdict.valid) process.exitCode = 1;
}

export async function removeAppKeyCommand(ctx: CommandContext<"required">): Promise<void> {
  const kind = requireKind(ctx, "rm");
  const { app, name } = await target(ctx);
  if (ctx.dryRun) {
    const plan = { dryRun: true, action: "rm", kind, application_id: app.applicationId };
    return void (ctx.json
      ? emitJson(ctx, plan)
      : ctx.ui.info(`[dry-run] would remove the ${KEY_LABEL[kind]} from ${name}`));
  }
  await apiCall(ctx, "Removing the key", () => removeAppKey(ctx.api, app.applicationId, kind));
  if (ctx.json) return emitJson(ctx, { deleted: true, kind, application_id: app.applicationId });
  ctx.ui.success(
    `Removed the ${KEY_LABEL[kind]} from \`${name}\`. Nothing was revoked at Apple, and your organization's copy is kept.`,
  );
}

export async function listAppKeySources(ctx: CommandContext<"required">): Promise<void> {
  const { app, name } = await target(ctx);
  const sources = await apiCall(ctx, "Loading keys on your other apps", () =>
    listKeySources(ctx.api, app.applicationId),
  );
  if (ctx.json) {
    return emitJson(ctx, {
      application_id: app.applicationId,
      api_key: sources.api_key,
      purchase_key: sources.purchase_key,
    });
  }
  const total = sources.api_key.length + sources.purchase_key.length;
  if (total === 0) return void ctx.ui.step(`No other app has a key \`${name}\` could use`);
  ctx.ui.step(`${total} key${total === 1 ? "" : "s"} on your other apps`);
  for (const kind of KEY_KINDS) {
    for (const source of sources[kind]) {
      const more = source.others_count > 0 ? ` and ${source.others_count} more` : "";
      ctx.ui.info(
        `\`${source.key_id}\`  ${KEY_LABEL[kind]}  from ${source.name}${more} (app ${source.application_id})`,
      );
    }
  }
}

export async function copyAppKeyCommand(ctx: CommandContext<"required">): Promise<void> {
  const kind = requireKind(ctx, "copy");
  const from = text(ctx, "from");
  if (!from) {
    throw new Error(
      `Usage: superwall asc keys copy ${kind} --app <id> --from <app id>. \`superwall asc keys sources --app <id>\` lists the apps to copy from.`,
    );
  }
  const { app, name } = await target(ctx);
  if (ctx.dryRun) {
    const plan = { dryRun: true, action: "copy", kind, application_id: app.applicationId, from };
    return void (ctx.json
      ? emitJson(ctx, plan)
      : ctx.ui.info(`[dry-run] would copy the ${KEY_LABEL[kind]} from app ${from} to ${name}`));
  }
  const copy = (confirmed: boolean) =>
    apiCall(ctx, `Copying the ${KEY_LABEL[kind]}`, () =>
      copyAppKey(ctx.api, app.applicationId, { kind, from, confirmed }),
    );
  let result = await copy(ctx.argv["allow-unconfirmed"] === true);
  if (!result.valid && result.unconfirmed && ctx.interactive) {
    ctx.ui.warn(result.unconfirmed);
    const save = await ctx.ui.confirm({ message: "Save this key anyway?" });
    if (save) result = await copy(true);
  }
  if (ctx.json) {
    emitJson(ctx, {
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
  if (!result.valid) process.exitCode = 1;
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

export async function importAppKeys(ctx: CommandContext<"required">): Promise<void> {
  const requested = ctx.argv.value2;
  const one = keyKind(requested);
  if (requested !== undefined && !one) {
    throw new Error("Usage: superwall asc keys import [api_key | purchase_key] --app <id>");
  }
  const kinds = one ? [one] : KEY_KINDS;
  const { app, name } = await target(ctx);
  if (ctx.dryRun) {
    const plan = { dryRun: true, action: "import", kinds, application_id: app.applicationId };
    return void (ctx.json
      ? emitJson(ctx, plan)
      : ctx.ui.info(`[dry-run] would try your organization's saved keys on ${name}`));
  }
  const results: KeyImportResult[] = [];
  for (const kind of kinds) {
    results.push(
      await apiCall(ctx, `Trying your organization's ${KEY_LABEL[kind]}s`, () =>
        importAppKey(ctx.api, app.applicationId, kind),
      ),
    );
  }
  const missing = results.some((result) => result.status === "not_found");
  if (missing) process.exitCode = 1;
  if (ctx.json) {
    return emitJson(ctx, {
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
    results
      .map((result) => `${result.status === "not_found" ? "✗" : "✓"} ${describeImport(result, name)}`)
      .join("\n"),
  );
}
