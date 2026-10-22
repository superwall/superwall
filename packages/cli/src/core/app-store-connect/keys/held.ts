import type { CommandContext } from "@/program/command";
import { readInput } from "@/program/host";
import {
  createAscConfig,
  replaceAppAscKey,
  replaceAppPurchaseKey,
  replaceAscConfig,
} from "@/core/app-store-connect/api/client";
import { resolveAscOrgApi } from "@/core/app-store-connect/api/request";
import type { SuperwallApi } from "@/core/api/client";
import type { AppKeyKind } from "@/core/api/integrations";
import { testModeWarning } from "@/core/main/bundle-id";
import { apiCall } from "@/ui/spinner";
import { chooseKeyApp, type KeyApp } from "./app";
import { KEY_LABEL } from "@/core/api/integrations";
import { differentBundleId, type AppFlags } from "../superwall-app";

interface HeldKey {
  keyId?: string;
  issuer?: string;
  keyFile?: string;
  name?: string;
}

interface HeldKeyRequest {
  action: "create" | "update";
  key: HeldKey;
  app?: AppFlags;
  kind?: AppKeyKind;
  team?: string;
  orgApi?: SuperwallApi;
}

function readKeyFile(path: string): string | undefined {
  try {
    return readInput(path);
  } catch {
    return undefined;
  }
}

interface KeyInput {
  keyId: string;
  issuerId: string;
  keyFile: string;
  privateKey: string;
  accountName?: string;
}

export async function upsertHeldKey(ctx: CommandContext<"required">, request: HeldKeyRequest): Promise<void> {
  const { action, team: teamId, app } = request;
  if (!app && action === "update" && !teamId) {
    throw new Error("Usage: superwall asc keys update --team <team id> --key-id <id> --issuer <id> --key-file <path.p8>");
  }
  if (!app && action === "create" && teamId) {
    throw new Error("To replace a team's key, run `superwall asc keys update --team <team id> ...`.");
  }
  const input = await resolveKeyInput(ctx, request.key, app !== undefined, action);
  if (!input) return void ctx.ui.warn("Cancelled.");
  if (app) return upsertAppKey(ctx, input, action, request.kind ?? "api_key", app);
  const { keyId, issuerId, keyFile, privateKey, accountName } = input;

  if (ctx.dryRun) {
    const plan = { dryRun: true, action, keyId, issuerId, keyFile, ...(teamId ? { teamId } : {}) };
    if (ctx.json) return ctx.output.data(plan);
    ctx.ui.info(`[dry-run] would upload ASC key ${keyId} (issuer ${issuerId}) from ${keyFile}`);
    return;
  }

  const credentials = { keyId, issuerId, privateKey, accountName };
  const api = request.orgApi ?? (await resolveAscOrgApi(ctx));
  const created = await apiCall(ctx, "Connecting App Store Connect", () => {
    if (teamId) return replaceAscConfig(api, teamId, credentials);
    return createAscConfig(api, { ...credentials, accountName: accountName ?? "App Store Connect" });
  });
  if (ctx.json) return ctx.output.data(created);
  ctx.ui.success(`App Store Connect connected ${created.team_id ?? created.id ?? ""}`);
}

function purchaseKeyBundleId(
  { app, name, savedBundleId: saved }: KeyApp,
  wanted: string | undefined,
): { bundleId: string; setApplicationBundleId: boolean } {
  if (!wanted) {
    if (saved) return { bundleId: saved, setApplicationBundleId: false };
    throw new Error(
      `\`${name}\` has no bundle ID in Superwall. Pass --bundle-id <id> to save it with the key, or set it first with \`superwall apps update ${app.applicationId} --bundle-id <id>\`.`,
    );
  }
  if (saved && saved !== wanted) {
    throw new Error(differentBundleId(name, app.applicationId, saved, wanted));
  }
  return { bundleId: wanted, setApplicationBundleId: saved === null };
}

async function upsertAppKey(
  ctx: CommandContext<"required">,
  input: KeyInput,
  action: "create" | "update",
  kind: AppKeyKind,
  flags: AppFlags,
): Promise<void> {
  const chosen = await chooseKeyApp(ctx, flags);
  const { app, name } = chosen;
  const bundle = kind === "purchase_key" ? purchaseKeyBundleId(chosen, flags.bundleId) : undefined;
  if (ctx.dryRun) {
    const plan = {
      dryRun: true,
      action,
      kind,
      application_id: app.applicationId,
      keyId: input.keyId,
      ...(bundle ? { bundle_id: bundle.bundleId, set_application_bundle_id: bundle.setApplicationBundleId } : {}),
    };
    if (ctx.json) return ctx.output.data(plan);
    const alsoBundle = bundle?.setApplicationBundleId ? ` and its bundle ID ${bundle.bundleId}` : "";
    ctx.ui.info(`[dry-run] would save ${KEY_LABEL[kind]} ${input.keyId}${alsoBundle} on ${name}`);
    return;
  }
  if (bundle?.setApplicationBundleId) {
    const warning = await testModeWarning(ctx, ctx.api, app.applicationId, bundle.bundleId);
    if (warning) ctx.ui.warn(warning);
  }
  const credentials = {
    keyId: input.keyId,
    issuerId: input.issuerId,
    privateKey: input.privateKey,
  };
  const verdict = await apiCall(ctx, `Saving the ${KEY_LABEL[kind]}`, () => {
    if (!bundle) return replaceAppAscKey(ctx.api, app, credentials);
    return replaceAppPurchaseKey(ctx.api, app, { ...credentials, ...bundle });
  });
  if (ctx.json) {
    ctx.output.data({
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
  if (!verdict.valid) ctx.fail();
}

async function resolveKeyInput(
  ctx: CommandContext,
  held: HeldKey,
  forApp: boolean,
  action: "create" | "update",
): Promise<KeyInput | null> {
  const { ui, interactive } = ctx;
  let { keyId, issuer: issuerId, keyFile, name } = held;

  if (interactive && (!keyId || !issuerId || !keyFile)) {
    ui.note(
      forApp
        ? "You'll need the key's Key ID, its Issuer ID, and the downloaded .p8 file,\nfrom App Store Connect → Users and Access → Integrations."
        : "Create a key in App Store Connect → Users and Access → Integrations →\nApp Store Connect API. You'll need its Key ID, the Issuer ID, and the\ndownloaded .p8 file. This is stored org-wide for the signed proxy.",
      forApp ? "Save an Apple key on the app" : "Connect App Store Connect",
    );
    if (!keyId) {
      const v = await ui.text({
        message: "Key ID",
        placeholder: "2X9R4HXF34",
        validate: (s) => (s?.trim() ? undefined : "Required"),
      });
      if (v === null) return null;
      keyId = v.trim();
    }
    if (!issuerId) {
      const v = await ui.text({
        message: "Issuer ID",
        placeholder: "57246542-96fe-1a63-e053-0824d011072a",
        validate: (s) => (s?.trim() ? undefined : "Required"),
      });
      if (v === null) return null;
      issuerId = v.trim();
    }
    if (!keyFile) {
      const v = await ui.text({
        message: "Path to the .p8 key file",
        placeholder: "~/Downloads/AuthKey_2X9R4HXF34.p8",
        validate: (s) => {
          const path = s?.trim() ?? "";
          if (!path) return "Required";
          return readKeyFile(path) === undefined ? "No file at that path" : undefined;
        },
      });
      if (v === null) return null;
      keyFile = v.trim();
    }
    if (!name && !forApp) {
      const v = await ui.text({
        message: "Name (optional)",
        placeholder: "App Store Connect",
      });
      if (v === null) return null;
      name = v.trim();
    }
  }

  if (!keyId || !issuerId || !keyFile) {
    throw new Error(
      forApp
        ? `Usage: superwall asc keys ${action} [api_key | purchase_key] --app <id> --key-id <id> --issuer <id> --key-file <path.p8>`
        : `Usage: superwall asc keys ${action} --key-id <id> --issuer <id> --key-file <path.p8>${action === "update" ? " --team <id>" : " [--name <name>]"}`,
    );
  }
  const privateKey = readKeyFile(keyFile);
  if (privateKey === undefined) throw new Error(`Couldn't find the .p8 key file at ${keyFile}`);
  return {
    keyId,
    issuerId,
    keyFile,
    privateKey,
    ...(name ? { accountName: name } : {}),
  };
}
