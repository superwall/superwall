
import type { CommandContext } from "@/program/command";
import { replaceAppAscKey, replaceAppPurchaseKey, type AppRef, type KeyVerdict } from "@/core/app-store-connect/api/client";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import { findIntegrations, type AppKeyKind, KEY_LABEL, keyKind } from "@/core/api/integrations";
import { appleDeps } from "@/core/app-store-connect/setup/deps";
import { upsertHeldKey } from "@/core/app-store-connect/keys/held";
import { chooseTeam, signIn, type SignInFlags } from "@/core/app-store-connect/setup/sign-in";
import { chooseIosApp, resolveApp, type AppFlags } from "@/core/app-store-connect/superwall-app";
import { savedKey } from "./app";
import {
  checkKeyAccess,
  createPurchaseKey,
  createTeamKey,
  type AppleKey,
  type AppleKeyKind,
  type TeamKeyRole,
} from "@/core/app-store-connect/apple-web/keys";
import { AppleError, type AppleSession } from "@/core/app-store-connect/apple-web/session";
import { testModeWarning } from "@/core/main/bundle-id";
import { blocks } from "@/program/output";
import { apiCall } from "@/ui/spinner";
import type { SignInDeps } from "../setup/sign-in";
import type { ResolvedApp } from "../superwall-app";

export interface AppleKeyDeps extends SignInDeps {
  sleep: (ms: number) => Promise<void>;
  writeKeyFile: (name: string, privateKey: string) => string;
}

export interface StepResult {
  status: "done" | "skipped" | "failed";
  detail?: string;
}


const KEY_NAME = "Superwall";
const KEY_FILE: Record<AppKeyKind, string> = { api_key: "AuthKey", purchase_key: "SubscriptionKey" };
const APPLE_KIND: Record<AppKeyKind, AppleKeyKind> = { api_key: "team", purchase_key: "purchase" };
const ACTIVATION_DELAYS = [1000, 2000, 3000];
const ACTIVATION_STATUSES = new Set([400, 401, 403, 422, 502]);


export function keyRole(requested: string | undefined): TeamKeyRole {
  const value = (requested ?? "app_manager").toUpperCase().replace(/-/g, "_");
  if (value === "APP_MANAGER" || value === "ADMIN") return value;
  throw new Error("--key-role must be app_manager or admin.");
}

function keyRefusal(error: AppleError, kind: AppKeyKind): string {
  const message = error.message.toLowerCase();
  if (message.includes("maximum") || message.includes("revoke")) {
    return "This team is at Apple's limit of active keys. Revoke an unused one in App Store Connect → Users and Access → Integrations, then run this again.";
  }
  if (error.kind === "forbidden" || message.includes("does not allow")) {
    return kind === "purchase_key"
      ? "Apple refused. Either this Apple Account isn't an Admin or the Account Holder, or the team has an agreement waiting to be signed at https://appstoreconnect.apple.com/agreements."
      : "Apple refused. Only an Admin or the Account Holder can create team keys, and the team's agreements must be signed at https://appstoreconnect.apple.com/agreements.";
  }
  return `Apple refused: ${error.message}`;
}

async function untilActive<T>(
  ctx: CommandContext,
  deps: AppleKeyDeps,
  label: string,
  work: () => Promise<T>,
  rejected: (result: T) => boolean,
): Promise<T> {
  return apiCall(ctx, label, async () => {
    for (let attempt = 0; ; attempt++) {
      const delay = ACTIVATION_DELAYS[attempt];
      try {
        const result = await work();
        if (!rejected(result) || delay === undefined) return result;
      } catch (error) {
        const retry = error instanceof ApiError && ACTIVATION_STATUSES.has(error.status);
        if (!retry || delay === undefined) throw error;
      }
      await deps.sleep(delay);
    }
  });
}

export async function keyAccess(
  ctx: CommandContext,
  session: AppleSession,
  kind: AppKeyKind,
): Promise<string> {
  try {
    await apiCall(ctx, `Checking ${KEY_LABEL[kind]} access`, () => {
      return checkKeyAccess(session, APPLE_KIND[kind]);
    });
    return "ok";
  } catch (error) {
    if (!(error instanceof AppleError)) throw error;
    return keyRefusal(error, kind);
  }
}

function keepKey(
  ctx: CommandContext,
  deps: AppleKeyDeps,
  kind: AppKeyKind,
  key: AppleKey,
  reason: string,
): string {
  const path = deps.writeKeyFile(`${KEY_FILE[kind]}_${key.id}.p8`, key.privateKey);
  const detail = `${reason} Apple only releases a key once, so it was saved to ${path} (issuer ${key.issuerId}).`;
  ctx.output.render(blocks.warning(detail));
  return detail;
}

export async function createAndSaveKey(
  ctx: CommandContext,
  deps: AppleKeyDeps,
  api: SuperwallApi,
  session: AppleSession,
  app: ResolvedApp,
  kind: AppKeyKind,
  role: TeamKeyRole,
): Promise<StepResult> {
  let key: AppleKey;
  try {
    key = await apiCall(ctx, `Creating the ${KEY_LABEL[kind]}`, () => {
      if (kind === "api_key") return createTeamKey(session, { name: KEY_NAME, role });
      return createPurchaseKey(session, { name: KEY_NAME });
    });
  } catch (error) {
    if (!(error instanceof AppleError)) throw error;
    const detail = keyRefusal(error, kind);
    ctx.output.render(blocks.warning(`${KEY_LABEL[kind]}: ${detail}`));
    return { status: "failed", detail };
  }

  const appRef: AppRef = { projectId: app.projectId, applicationId: app.applicationId };
  const credentials = { keyId: key.id, issuerId: key.issuerId, privateKey: key.privateKey };
  const setApplicationBundleId = kind === "purchase_key" && app.savedBundleId === null;
  const save = (): Promise<KeyVerdict> => {
    if (kind === "api_key") return replaceAppAscKey(api, appRef, credentials);
    return replaceAppPurchaseKey(api, appRef, { ...credentials, bundleId: app.bundleId, setApplicationBundleId });
  };
  let reason: string;
  try {
    const verdict = await untilActive(
      ctx,
      deps,
      `Saving the ${KEY_LABEL[kind]} on ${app.name}`,
      save,
      (result) => !result.valid,
    );
    if (verdict.valid) {
      if (setApplicationBundleId) {
        ctx.output.render(
          blocks.info(`Saved the bundle ID ${app.bundleId} on \`${app.name}\` with the key`),
        );
      }
      return { status: "done", detail: key.id };
    }
    reason = `Apple hasn't accepted the new key yet${verdict.error ? ` (${verdict.error})` : ""}.`;
  } catch (error) {
    reason = `Superwall couldn't save the key: ${error instanceof Error ? error.message : String(error)}.`;
  }
  return { status: "failed", detail: keepKey(ctx, deps, kind, key, reason) };
}

interface AppleCreate {
  kind: AppKeyKind;
  role: string | undefined;
  replace: boolean;
  team: string | undefined;
  app: AppFlags;
  signIn: SignInFlags;
}

async function createAtApple(ctx: CommandContext<"required">, request: AppleCreate): Promise<void> {
  const { api } = ctx;
  const deps = appleDeps;
  const { kind } = request;
  const role = keyRole(request.role);

  ctx.output.render(blocks.intro(`Create an ${KEY_LABEL[kind]}`));
  const chosen = await chooseIosApp(ctx, api, request.app);
  const applicationId = String(chosen.app.id);
  const appName = chosen.app.name ?? applicationId;
  const existing = savedKey(
    await apiCall(ctx, "Checking what is saved", () => findIntegrations(api, applicationId)),
    kind,
  );
  if (existing && !request.replace) {
    if (ctx.json) {
      return ctx.output.data({
        status: "already_saved",
        kind,
        key_id: existing.key_id,
        app: { id: applicationId, project_id: String(chosen.project.id), name: appName },
      });
    }
    ctx.ui.success(
      `\`${appName}\` already has an ${KEY_LABEL[kind]} (${existing.key_id}). Nothing was created. Pass --replace to create another and save it instead.`,
    );
    return;
  }

  const session = await signIn(ctx, deps, `asc keys create ${kind}`, request.signIn);
  if (!session) return;
  const appleTeam = await chooseTeam(ctx, session, request.team);
  ctx.output.render(blocks.info(`Apple team \`${appleTeam.name}\``));

  if (ctx.dryRun) {
    const access = await keyAccess(ctx, session, kind);
    if (ctx.json) return ctx.output.data({ dryRun: true, kind, team: appleTeam, access });
    ctx.ui.report(`${access === "ok" ? "✓" : "✗"} ${KEY_LABEL[kind]}  ${access}`);
    ctx.ui.info("[dry-run] nothing was created or changed.");
    return;
  }

  const resolved = await resolveApp(ctx, api, session, { kind: "existing", ...chosen }, request.app);
  if (kind === "purchase_key" && resolved.savedBundleId === null) {
    const warning = await testModeWarning(ctx, api, resolved.applicationId, resolved.bundleId);
    if (warning) ctx.output.render(blocks.warning(warning));
  }
  const result = await createAndSaveKey(ctx, deps, api, session, resolved, kind, role);
  const created = result.status === "done";
  if (ctx.json) {
    ctx.output.data({
      status: created ? "created" : "failed",
      kind,
      key_id: created ? result.detail : null,
      detail: created ? null : result.detail,
      replaced: created && existing ? existing.key_id : null,
      team: appleTeam,
      app: {
        id: resolved.applicationId,
        project_id: resolved.projectId,
        name: resolved.name,
        bundle_id: resolved.bundleId,
      },
      ...(kind === "purchase_key" ? { bundle_id_saved: created && resolved.savedBundleId === null } : {}),
    });
  } else if (created) {
    ctx.ui.success(`${KEY_LABEL[kind]} ${result.detail} created and saved on \`${resolved.name}\`.`);
  }
  if (!created) ctx.fail();
}

interface AscKeysCreateInput {
  args: { kind: string | undefined; };
  flags: { keyFile: string | undefined; keyId: string | undefined; issuer: string | undefined; name: string | undefined; bundleId: string | undefined; appleId: string | undefined; applePassword: string | undefined; code: string | undefined; sms: boolean; phone: string | undefined; team: string | undefined; keyRole: string | undefined; replace: boolean; app: string | undefined; project: string | undefined; dryRun: boolean; };
}

export async function runAscKeysCreate(ctx: CommandContext<"required">, { args, flags }: AscKeysCreateInput): Promise<void> {
  const kind = keyKind(args.kind);
  const app = { app: flags.app, project: flags.project, bundleId: flags.bundleId };
  if (flags.keyFile !== undefined) {
    return upsertHeldKey(ctx, {
      action: "create",
      key: { keyId: flags.keyId, issuer: flags.issuer, keyFile: flags.keyFile, name: flags.name },
      ...(flags.app === undefined ? {} : { app }),
      kind,
      team: flags.team,
    });
  }
  if (!kind) throw new Error("Usage: superwall asc keys create <api_key | purchase_key> --app <id>");
  return createAtApple(ctx, {
    kind,
    role: flags.keyRole,
    replace: flags.replace,
    team: flags.team,
    app,
    signIn: { appleId: flags.appleId, password: flags.applePassword, code: flags.code, sms: flags.sms, phone: flags.phone },
  });
}
