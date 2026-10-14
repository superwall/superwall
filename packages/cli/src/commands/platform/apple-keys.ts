import type { CommandContext } from "@/command";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import { saveAppAscKey, saveAppPurchaseKey, type AppRef, type KeyVerdict } from "@/core/api/asc";
import { getIntegrations, type AppKeyKind, type SavedAppKey } from "@/core/api/integrations";
import {
  checkKeyAccess,
  createPurchaseKey,
  createTeamKey,
  type AppleKey,
  type AppleKeyKind,
  type TeamKeyRole,
} from "@/core/apple/keys";
import { AppleError, type AppleSession, type AppleTeam } from "@/core/apple/session";
import { blocks } from "@/output";
import { apiCall, emitJson } from "@/commands/api-output";
import { chooseIosApp, resolveApp, type AppFlags, type ResolvedApp } from "./apple-app";
import {
  describeChallenge,
  signInToApple,
  type SignInDeps,
  type SignInFlags,
} from "./apple-sign-in";

export interface AppleKeyDeps extends SignInDeps {
  sleep: (ms: number) => Promise<void>;
  writeKeyFile: (name: string, privateKey: string) => string;
}

export interface StepResult {
  status: "done" | "skipped" | "failed";
  detail?: string;
}

export const KEY_KINDS: AppKeyKind[] = ["api_key", "purchase_key"];

export const KEY_LABEL: Record<AppKeyKind, string> = {
  api_key: "App Store Connect API key",
  purchase_key: "In-App Purchase key",
};

const KEY_NAME = "Superwall";
const KEY_FILE: Record<AppKeyKind, string> = { api_key: "AuthKey", purchase_key: "SubscriptionKey" };
const APPLE_KIND: Record<AppKeyKind, AppleKeyKind> = { api_key: "team", purchase_key: "purchase" };
const ACTIVATION_DELAYS = [1000, 2000, 3000];
const ACTIVATION_STATUSES = new Set([400, 401, 403, 422, 502]);

export function text(ctx: CommandContext, name: string): string | undefined {
  const value = ctx.argv[name];
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function keyKind(value: unknown): AppKeyKind | undefined {
  return KEY_KINDS.find((kind) => kind === value);
}

export function keyRole(ctx: CommandContext): TeamKeyRole {
  const value = (text(ctx, "key-role") ?? "app_manager").toUpperCase().replace(/-/g, "_");
  if (value === "APP_MANAGER" || value === "ADMIN") return value;
  throw new Error("--key-role must be app_manager or admin.");
}

export const appFlags = (ctx: CommandContext): AppFlags => ({
  app: text(ctx, "app"),
  project: text(ctx, "project"),
  bundleId: text(ctx, "bundle-id"),
});

export const signInFlags = (ctx: CommandContext): SignInFlags => ({
  appleId: text(ctx, "apple-id"),
  password:
    typeof ctx.argv["apple-password"] === "string" && ctx.argv["apple-password"] !== ""
      ? ctx.argv["apple-password"]
      : undefined,
  code: text(ctx, "code"),
  sms: ctx.argv.sms === true,
  phone: text(ctx, "phone"),
});

export const savedKey = (
  saved: { app_store_connect_configuration: SavedAppKey | null; in_app_purchase_configuration: SavedAppKey | null },
  kind: AppKeyKind,
): SavedAppKey | undefined =>
  (kind === "api_key" ? saved.app_store_connect_configuration : saved.in_app_purchase_configuration) ??
  undefined;

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

export async function untilActive<T>(
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

export async function chooseTeam(
  ctx: CommandContext,
  session: AppleSession,
  requested: string | undefined,
): Promise<AppleTeam> {
  const teams = session.teams();
  if (requested) {
    const found = teams.find(
      (team) =>
        String(team.id) === requested || team.name.toLowerCase() === requested.toLowerCase(),
    );
    if (!found) {
      throw new Error(
        `This Apple Account isn't on team ${requested}. Its teams: ${teams.map((team) => `${team.id} (${team.name})`).join(", ")}.`,
      );
    }
    await session.selectTeam(found.id);
    return session.team();
  }
  if (teams.length <= 1) return session.team();
  if (!ctx.interactive) {
    throw new Error(
      `This Apple Account is on several teams: ${teams.map((team) => `${team.id} (${team.name})`).join(", ")}. Pass --team <id>.`,
    );
  }
  const picked = await ctx.ui.select({
    message: "Which Apple team?",
    options: teams.map((team) => ({ value: String(team.id), label: team.name })),
    initialValue: String(session.team().id),
  });
  if (picked === null) throw new Error("Cancelled.");
  await session.selectTeam(Number(picked));
  return session.team();
}

export async function signIn(
  ctx: CommandContext,
  deps: AppleKeyDeps,
  command: string,
): Promise<AppleSession | undefined> {
  const signedIn = await signInToApple(ctx, deps, signInFlags(ctx));
  if (signedIn.status === "signed-in") return signedIn.session;
  const next = `superwall ${command} --code <code>`;
  if (ctx.json) {
    emitJson(ctx, {
      status: "verification_required",
      method: signedIn.challenge.method,
      destination: signedIn.challenge.destination ?? null,
      next,
    });
  } else {
    ctx.ui.warn(
      `${describeChallenge(signedIn.challenge)}\nRun \`${next}\` with the same flags within 10 minutes to continue, or add --sms to get a text instead.`,
    );
  }
  process.exitCode = 1;
  return undefined;
}

export async function keyAccess(
  ctx: CommandContext,
  session: AppleSession,
  kind: AppKeyKind,
): Promise<string> {
  try {
    await apiCall(ctx, `Checking ${KEY_LABEL[kind]} access`, () =>
      checkKeyAccess(session, APPLE_KIND[kind]),
    );
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
    key = await apiCall(ctx, `Creating the ${KEY_LABEL[kind]}`, () =>
      kind === "api_key"
        ? createTeamKey(session, { name: KEY_NAME, role })
        : createPurchaseKey(session, { name: KEY_NAME }),
    );
  } catch (error) {
    if (!(error instanceof AppleError)) throw error;
    const detail = keyRefusal(error, kind);
    ctx.output.render(blocks.warning(`${KEY_LABEL[kind]}: ${detail}`));
    return { status: "failed", detail };
  }

  const appRef: AppRef = { projectId: app.projectId, applicationId: app.applicationId };
  const credentials = { keyId: key.id, issuerId: key.issuerId, privateKey: key.privateKey };
  const save = (): Promise<KeyVerdict> =>
    kind === "api_key"
      ? saveAppAscKey(api, appRef, credentials)
      : saveAppPurchaseKey(api, appRef, { ...credentials, bundleId: app.bundleId });
  let reason: string;
  try {
    const verdict = await untilActive(
      ctx,
      deps,
      `Saving the ${KEY_LABEL[kind]} on ${app.name}`,
      save,
      (result) => !result.valid,
    );
    if (verdict.valid) return { status: "done", detail: key.id };
    reason = `Apple hasn't accepted the new key yet${verdict.error ? ` (${verdict.error})` : ""}.`;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    reason = `Superwall couldn't save the key: ${error.message}.`;
  }
  return { status: "failed", detail: keepKey(ctx, deps, kind, key, reason) };
}

export async function createAppKey(
  ctx: CommandContext<"required">,
  deps: AppleKeyDeps,
): Promise<void> {
  const { api } = ctx;
  const kind = keyKind(ctx.argv.value2);
  if (!kind) throw new Error("Usage: superwall asc keys create <api_key | purchase_key> --app <id>");
  const role = keyRole(ctx);
  const flags = appFlags(ctx);
  const command = `asc keys create ${kind}`;

  ctx.output.render(blocks.intro(`Create an ${KEY_LABEL[kind]}`));
  const chosen = await chooseIosApp(ctx, api, flags);
  const applicationId = String(chosen.app.id);
  const appName = chosen.app.name ?? applicationId;
  const existing = savedKey(
    await apiCall(ctx, "Checking what is saved", () => getIntegrations(api, applicationId)),
    kind,
  );
  if (existing && ctx.argv.replace !== true) {
    if (ctx.json) {
      return emitJson(ctx, {
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

  const session = await signIn(ctx, deps, command);
  if (!session) return;
  const team = await chooseTeam(ctx, session, text(ctx, "team"));
  ctx.output.render(blocks.info(`Apple team \`${team.name}\``));

  if (ctx.dryRun) {
    const access = await keyAccess(ctx, session, kind);
    if (ctx.json) return emitJson(ctx, { dryRun: true, kind, team, access });
    ctx.ui.report(`${access === "ok" ? "✓" : "✗"} ${KEY_LABEL[kind]}  ${access}`);
    ctx.ui.info("[dry-run] nothing was created or changed.");
    return;
  }

  const app = await resolveApp(ctx, api, session, { kind: "existing", ...chosen }, flags);
  const result = await createAndSaveKey(ctx, deps, api, session, app, kind, role);
  const created = result.status === "done";
  if (ctx.json) {
    emitJson(ctx, {
      status: created ? "created" : "failed",
      kind,
      key_id: created ? result.detail : null,
      detail: created ? null : result.detail,
      replaced: created && existing ? existing.key_id : null,
      team,
      app: { id: app.applicationId, project_id: app.projectId, name: app.name, bundle_id: app.bundleId },
    });
  } else if (created) {
    ctx.ui.success(`${KEY_LABEL[kind]} ${result.detail} created and saved on \`${app.name}\`.`);
  }
  if (!created) process.exitCode = 1;
}
