import type { CommandContext } from "@/command";
import { requireOrg } from "@/core/account/org";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import {
  createAscConfig,
  getAppNotificationUrl,
  listAscConfigs,
  saveAppAscKey,
  saveAppPurchaseKey,
  updateAscConfig,
  type AppRef,
  type KeyVerdict,
} from "@/core/api/asc";
import {
  planServerNotifications,
  readServerNotifications,
  setServerNotifications,
} from "@/core/api/asc-notifications";
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
import { chooseAppIntent, resolveApp, type AppFlags, type ResolvedApp } from "./apple-app";
import {
  describeChallenge,
  signInToApple,
  type SignInDeps,
  type SignInFlags,
} from "./apple-sign-in";

export interface AppleSetupDeps extends SignInDeps {
  sleep: (ms: number) => Promise<void>;
  writeKeyFile: (name: string, privateKey: string) => string;
}

type Step = "team_key" | "purchase_key" | "webhook";

interface StepResult {
  status: "done" | "skipped" | "failed";
  detail?: string;
}

const KEY_NAME = "Superwall";
const ACTIVATION_DELAYS = [2000, 4000, 6000, 8000, 10_000, 15_000, 15_000];
const ACTIVATION_STATUSES = new Set([400, 401, 403, 422, 502]);

const STEP_LABEL: Record<Step, string> = {
  team_key: "App Store Connect API key",
  purchase_key: "In-App Purchase key",
  webhook: "Server notification URL",
};

function text(ctx: CommandContext, name: string): string | undefined {
  const value = ctx.argv[name];
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function keyRole(ctx: CommandContext): TeamKeyRole {
  const value = (text(ctx, "key-role") ?? "app_manager").toUpperCase().replace(/-/g, "_");
  if (value === "APP_MANAGER" || value === "ADMIN") return value;
  throw new Error("--key-role must be app_manager or admin.");
}

function keyRefusal(error: AppleError, kind: AppleKeyKind): string {
  const message = error.message.toLowerCase();
  if (message.includes("maximum") || message.includes("revoke")) {
    return "This team is at Apple's limit of active keys. Revoke an unused one in App Store Connect → Users and Access → Integrations, then run this again.";
  }
  if (error.kind === "forbidden" || message.includes("does not allow")) {
    return kind === "purchase"
      ? "Apple refused. Either this Apple Account isn't an Admin or the Account Holder, or the team has an agreement waiting to be signed at https://appstoreconnect.apple.com/agreements."
      : "Apple refused. Only an Admin or the Account Holder can create team keys, and the team's agreements must be signed at https://appstoreconnect.apple.com/agreements.";
  }
  return `Apple refused: ${error.message}`;
}

async function untilActive<T>(
  ctx: CommandContext,
  deps: AppleSetupDeps,
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

async function chooseTeam(
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

async function saveOrgKey(
  ctx: CommandContext,
  deps: AppleSetupDeps,
  api: SuperwallApi,
  key: AppleKey,
  team: AppleTeam,
): Promise<string> {
  const credentials = {
    keyId: key.id,
    issuerId: key.issuerId,
    privateKey: key.privateKey,
    accountName: team.name,
  };
  const existing = (await listAscConfigs(api)).find((config) => config.issuer_id === key.issuerId);
  const existingTeam = existing?.team_id;
  const saved = await untilActive(
    ctx,
    deps,
    "Connecting the key to your organization",
    () =>
      typeof existingTeam === "string"
        ? updateAscConfig(api, existingTeam, credentials)
        : createAscConfig(api, credentials),
    () => false,
  );
  return String(saved.team_id ?? existingTeam ?? "");
}

async function connectedTeamId(api: SuperwallApi, team: AppleTeam): Promise<string | undefined> {
  const configs = await listAscConfigs(api);
  const match = configs.find((config) => config.issuer_id === team.issuerId);
  return typeof match?.team_id === "string" ? match.team_id : undefined;
}

function keepKey(
  ctx: CommandContext,
  deps: AppleSetupDeps,
  prefix: string,
  key: AppleKey,
  reason: string,
): string {
  const path = deps.writeKeyFile(`${prefix}_${key.id}.p8`, key.privateKey);
  const detail = `${reason} Apple only releases a key once, so it was saved to ${path} (issuer ${key.issuerId}).`;
  ctx.output.render(blocks.warning(detail));
  return detail;
}

export async function setupApple(
  ctx: CommandContext<"required">,
  deps: AppleSetupDeps,
): Promise<void> {
  const { api } = ctx;
  const role = keyRole(ctx);
  const skip: Record<Step, boolean> = {
    team_key: ctx.argv["skip-team-key"] === true,
    purchase_key: ctx.argv["skip-purchase-key"] === true,
    webhook: ctx.argv["skip-webhook"] === true,
  };
  const appFlags: AppFlags = {
    app: text(ctx, "app"),
    project: text(ctx, "project"),
    bundleId: text(ctx, "bundle-id"),
  };
  const signInFlags: SignInFlags = {
    appleId: text(ctx, "apple-id"),
    password:
      typeof ctx.argv["apple-password"] === "string" && ctx.argv["apple-password"] !== ""
        ? ctx.argv["apple-password"]
        : undefined,
    code: text(ctx, "code"),
    sms: ctx.argv.sms === true,
    phone: text(ctx, "phone"),
  };

  ctx.output.render(blocks.intro("Set up Apple"));
  await requireOrg(api, ctx.interactive);
  const intent = ctx.dryRun ? undefined : await chooseAppIntent(ctx, api, appFlags);

  const signedIn = await signInToApple(ctx, deps, signInFlags);
  if (signedIn.status === "verification-required") {
    const next = "superwall setup apple --code <code>";
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
    return;
  }
  const { session } = signedIn;
  const team = await chooseTeam(ctx, session, text(ctx, "team"));
  ctx.output.render(blocks.info(`Apple team \`${team.name}\``));

  if (ctx.dryRun || !intent) {
    const access: Record<string, string> = {};
    for (const kind of ["team", "purchase"] as const) {
      try {
        await apiCall(ctx, `Checking ${kind} key access`, () => checkKeyAccess(session, kind));
        access[kind] = "ok";
      } catch (error) {
        if (!(error instanceof AppleError)) throw error;
        access[kind] = keyRefusal(error, kind);
      }
    }
    if (ctx.json) return emitJson(ctx, { dryRun: true, team, access });
    ctx.ui.report(
      [
        `${access.team === "ok" ? "✓" : "✗"} Team keys  ${access.team}`,
        `${access.purchase === "ok" ? "✓" : "✗"} In-App Purchase keys  ${access.purchase}`,
      ].join("\n"),
    );
    ctx.ui.info("[dry-run] nothing was created or changed.");
    return;
  }

  const app: ResolvedApp = await resolveApp(ctx, api, session, intent, appFlags);
  const appRef: AppRef = { projectId: app.projectId, applicationId: app.applicationId };
  ctx.output.render(
    blocks.info(`${app.created ? "Created" : "Using"} \`${app.name}\`  ${app.bundleId}`),
  );

  const results: Record<Step, StepResult> = {
    team_key: { status: "skipped" },
    purchase_key: { status: "skipped" },
    webhook: { status: "skipped" },
  };
  const fail = (step: Step, detail: string): void => {
    results[step] = { status: "failed", detail };
    ctx.output.render(blocks.warning(`${STEP_LABEL[step]}: ${detail}`));
  };

  let teamKey: AppleKey | undefined;
  let teamId: string | undefined;
  if (!skip.team_key) {
    try {
      teamKey = await apiCall(ctx, "Creating the App Store Connect API key", () =>
        createTeamKey(session, { name: KEY_NAME, role }),
      );
    } catch (error) {
      if (!(error instanceof AppleError)) throw error;
      fail("team_key", keyRefusal(error, "team"));
    }
  }
  if (teamKey) {
    try {
      teamId = await saveOrgKey(ctx, deps, api, teamKey, team);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      results.team_key = {
        status: "failed",
        detail: keepKey(ctx, deps, "AuthKey", teamKey, `Superwall couldn't save the key: ${error.message}.`),
      };
      teamKey = undefined;
    }
  }
  teamId ??= await connectedTeamId(api, team);


  const saveToApp = async (
    step: Step,
    label: string,
    prefix: string,
    key: AppleKey,
    save: () => Promise<KeyVerdict>,
  ): Promise<void> => {
    let reason: string;
    try {
      const verdict = await untilActive(ctx, deps, label, save, (result) => !result.valid);
      if (verdict.valid) {
        results[step] = { status: "done", detail: key.id };
        return;
      }
      reason = `Apple hasn't accepted the new key yet${verdict.error ? ` (${verdict.error})` : ""}.`;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      reason = `Superwall couldn't save the key: ${error.message}.`;
    }
    results[step] = { status: "failed", detail: keepKey(ctx, deps, prefix, key, reason) };
  };

  if (teamKey) {
    const key = teamKey;
    await saveToApp("team_key", `Saving the key on ${app.name}`, "AuthKey", key, () =>
      saveAppAscKey(api, appRef, {
        keyId: key.id,
        issuerId: key.issuerId,
        privateKey: key.privateKey,
      }),
    );
  }

  if (!skip.purchase_key) {
    let purchaseKey: AppleKey | undefined;
    try {
      purchaseKey = await apiCall(ctx, "Creating the In-App Purchase key", () =>
        createPurchaseKey(session, { name: KEY_NAME }),
      );
    } catch (error) {
      if (!(error instanceof AppleError)) throw error;
      fail("purchase_key", keyRefusal(error, "purchase"));
    }
    if (purchaseKey) {
      const key = purchaseKey;
      const bundleId = app.bundleId;
      await saveToApp(
        "purchase_key",
        `Saving the In-App Purchase key on ${app.name}`,
        "SubscriptionKey",
        key,
        () =>
          saveAppPurchaseKey(api, appRef, {
            bundleId,
            keyId: key.id,
            issuerId: key.issuerId,
            privateKey: key.privateKey,
          }),
      );
    }
  }

  let webhookUrl: string | undefined;
  if (!skip.webhook) {
    const ascAppId = app.ascAppId;
    if (!teamId) {
      fail("webhook", "No App Store Connect key is connected for this team, so the URL can't be read.");
    } else {
      const connectedTeam = teamId;
      try {
        const wanted = await getAppNotificationUrl(api, appRef);
        webhookUrl = wanted;
        const existing = await untilActive(
          ctx,
          deps,
          "Reading the server notification URL",
          () => readServerNotifications(api, connectedTeam, ascAppId),
          () => false,
        );
        const plan = planServerNotifications(existing, wanted);
        if (plan.status === "conflict") {
          const found = [
            plan.existing.production ? `Production: ${plan.existing.production}` : undefined,
            plan.existing.sandbox ? `Sandbox: ${plan.existing.sandbox}` : undefined,
          ].filter((line): line is string => line !== undefined);
          results.webhook = {
            status: "failed",
            detail: `A server notification URL is already set, and Superwall won't replace it. ${found.join(" · ")}`,
          };
          if (!ctx.json) {
            ctx.ui.error(
              [
                "A server notification URL is already set on this app. Superwall won't replace it.",
                ...found.map((line) => `  ${line}`),
                "Apple allows one URL per environment. To switch, clear it in App Store Connect → App Information → App Store Server Notifications, then run this again.",
              ].join("\n"),
            );
          }
        } else if (plan.status === "already-set") {
          results.webhook = { status: "done", detail: "already set" };
        } else {
          await apiCall(ctx, "Setting the server notification URL", () =>
            setServerNotifications(api, connectedTeam, ascAppId, wanted, plan),
          );
          results.webhook = { status: "done", detail: "set" };
        }
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        fail("webhook", `App Store Connect refused: ${error.message}`);
      }
    }
  }

  const failed = (Object.keys(results) as Step[]).filter(
    (step) => results[step].status === "failed",
  );
  if (ctx.json) {
    emitJson(ctx, {
      status: failed.length === 0 ? "ok" : "partial",
      team,
      app: {
        id: app.applicationId,
        project_id: app.projectId,
        name: app.name,
        bundle_id: app.bundleId,
        created: app.created,
      },
      steps: results,
      webhook_url: webhookUrl ?? null,
      failed,
    });
  } else {
    const mark = { done: "✓", skipped: "–", failed: "✗" } as const;
    ctx.ui.report(
      (Object.keys(results) as Step[])
        .map((step) => {
          const result = results[step];
          const value =
            result.status === "failed" ? "not done" : (result.detail ?? result.status);
          return `${mark[result.status]} ${STEP_LABEL[step]}  ${value}`;
        })
        .join("\n"),
    );
    if (failed.length === 0) ctx.ui.success(`Apple is connected for \`${app.name}\`.`);
    else ctx.ui.warn("Partly done. What succeeded was saved; fix the items above and run it again.");
  }
  if (failed.length > 0) process.exitCode = 1;
}
