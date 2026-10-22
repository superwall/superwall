import type { CommandContext } from "@/program/command";
import type { AppRef } from "@/core/app-store-connect/api/client";
import { ApiError } from "@/core/api/client";
import { findIntegrations, RefusedByApi, updateBundleId, type AppKeyKind } from "@/core/api/integrations";
import { createAndSaveKey, keyAccess, keyRole, type StepResult } from "@/core/app-store-connect/keys/create";
import { savedKey } from "@/core/app-store-connect/keys/app";
import { KEY_KINDS, KEY_LABEL } from "@/core/api/integrations";
import { appleDeps } from "@/core/app-store-connect/setup/deps";
import {
  describeNotificationUrl,
  ensureNotificationUrl,
  environmentLines,
} from "@/core/app-store-connect/notification-url";
import { chooseTeam, signIn } from "@/core/app-store-connect/setup/sign-in";
import { chooseAppIntent, resolveApp, type AppIntent, type ResolvedApp } from "@/core/app-store-connect/superwall-app";
import { testModeWarning } from "@/core/main/bundle-id";
import { blocks } from "@/program/output";
import { apiCall } from "@/ui/spinner";

export type Step = AppKeyKind | "bundle_id" | "notification_url";

const STEPS: Step[] = [...KEY_KINDS, "bundle_id", "notification_url"];

const STEP_LABEL: Record<Step, string> = {
  ...KEY_LABEL,
  bundle_id: "Bundle ID",
  notification_url: "Server notification URL",
};

async function saveAppBundleId(ctx: CommandContext<"required">, resolved: ResolvedApp): Promise<StepResult> {
  try {
    await apiCall(ctx, `Saving the bundle ID on ${resolved.name}`, () => {
      return updateBundleId(ctx.api, resolved.applicationId, { bundleId: resolved.bundleId, replace: false });
    });
  } catch (error) {
    if (!(error instanceof ApiError) && !(error instanceof RefusedByApi)) throw error;
    ctx.output.render(blocks.warning(`${STEP_LABEL.bundle_id}: ${error.message}`));
    return { status: "failed", detail: error.message };
  }
  ctx.output.render(blocks.info(`Saved the bundle ID ${resolved.bundleId} on \`${resolved.name}\``));
  return { status: "done", detail: `${resolved.bundleId} (saved)` };
}

interface SetupAppleInput {
  flags: { appleId: string | undefined; applePassword: string | undefined; code: string | undefined; sms: boolean; phone: string | undefined; team: string | undefined; app: string | undefined; project: string | undefined; bundleId: string | undefined; keyRole: string | undefined; skipApiKey: boolean; skipPurchaseKey: boolean; skipNotificationUrl: boolean; dryRun: boolean; };
}

export async function runSetupApple(ctx: CommandContext<"required">, { flags }: SetupAppleInput): Promise<void> {
  const { api } = ctx;
  const deps = appleDeps;
  const role = keyRole(flags.keyRole);
  const skip: Record<Step, boolean> = {
    api_key: flags.skipApiKey,
    purchase_key: flags.skipPurchaseKey,
    bundle_id: false,
    notification_url: flags.skipNotificationUrl,
  };
  const appFlags = { app: flags.app, project: flags.project, bundleId: flags.bundleId };

  ctx.output.render(blocks.intro("Set up Apple"));
  let intent: AppIntent | undefined;
  if (!ctx.dryRun) intent = await chooseAppIntent(ctx, api, appFlags);

  const session = await signIn(ctx, deps, "setup apple", {
    appleId: flags.appleId,
    password: flags.applePassword,
    code: flags.code,
    sms: flags.sms,
    phone: flags.phone,
  });
  if (!session) return;
  const appleTeam = await chooseTeam(ctx, session, flags.team);
  ctx.output.render(blocks.info(`Apple team \`${appleTeam.name}\``));

  if (ctx.dryRun || !intent) {
    const access = {
      api_key: await keyAccess(ctx, session, "api_key"),
      purchase_key: await keyAccess(ctx, session, "purchase_key"),
    };
    if (ctx.json) return ctx.output.data({ dryRun: true, team: appleTeam, access });
    ctx.ui.report(
      KEY_KINDS.map((kind) => `${access[kind] === "ok" ? "✓" : "✗"} ${KEY_LABEL[kind]}  ${access[kind]}`).join("\n"),
    );
    ctx.ui.info("[dry-run] nothing was created or changed.");
    return;
  }

  const resolved = await resolveApp(ctx, api, session, intent, appFlags);
  const appRef: AppRef = { projectId: resolved.projectId, applicationId: resolved.applicationId };
  ctx.output.render(blocks.info(`${resolved.created ? "Created" : "Using"} \`${resolved.name}\`  ${resolved.bundleId}`));

  const results: Record<Step, StepResult> = {
    api_key: { status: "skipped" },
    purchase_key: { status: "skipped" },
    bundle_id: { status: "done", detail: resolved.bundleId },
    notification_url: { status: "skipped" },
  };

  if (resolved.savedBundleId === null) {
    const warning = await testModeWarning(ctx, api, resolved.applicationId, resolved.bundleId);
    if (warning) ctx.output.render(blocks.warning(warning));
  }

  const saved = await findIntegrations(api, resolved.applicationId);
  let bundleIdSaved = resolved.savedBundleId !== null;
  for (const kind of KEY_KINDS) {
    if (skip[kind]) continue;
    const existing = savedKey(saved, kind);
    if (existing) {
      results[kind] = { status: "done", detail: `${existing.key_id} (already saved)` };
      continue;
    }
    results[kind] = await createAndSaveKey(ctx, deps, api, session, resolved, kind, role);
    if (kind === "purchase_key" && results[kind].status === "done" && !bundleIdSaved) {
      bundleIdSaved = true;
      results.bundle_id = { status: "done", detail: `${resolved.bundleId} (saved with the key)` };
    }
  }
  if (!bundleIdSaved) results.bundle_id = await saveAppBundleId(ctx, resolved);

  let notificationUrl: string | undefined;
  if (!skip.notification_url) {
    try {
      const outcome = await ensureNotificationUrl(ctx, deps.sleep, api, appRef, { setRevenueProvider: false });
      notificationUrl = outcome.url;
      if (outcome.status === "set" || outcome.status === "already_set") {
        results.notification_url = { status: "done", detail: outcome.status === "set" ? "set" : "already set" };
      } else {
        const detail = [describeNotificationUrl(outcome), ...environmentLines(outcome)].join(" ");
        results.notification_url = { status: "failed", detail };
        if (!ctx.json) {
          const shown = [describeNotificationUrl(outcome), ...environmentLines(outcome).map((line) => `  ${line}`)].join("\n");
          ctx.ui.error(
            outcome.status === "conflict"
              ? `${shown}\nApple allows one URL per environment. To switch, clear it in App Store Connect → App Information → App Store Server Notifications, then run this again.`
              : shown,
          );
        }
      }
    } catch (error) {
      if (!(error instanceof ApiError) && !(error instanceof RefusedByApi)) throw error;
      results.notification_url = { status: "failed", detail: error.message };
      ctx.output.render(blocks.warning(`${STEP_LABEL.notification_url}: ${error.message}`));
    }
  }

  const failed = STEPS.filter((step) => results[step].status === "failed");
  if (ctx.json) {
    ctx.output.data({
      status: failed.length === 0 ? "ok" : "partial",
      team: appleTeam,
      app: {
        id: resolved.applicationId,
        project_id: resolved.projectId,
        name: resolved.name,
        bundle_id: resolved.bundleId,
        created: resolved.created,
      },
      steps: results,
      notification_url: notificationUrl ?? null,
      failed,
    });
  } else {
    const mark = { done: "✓", skipped: "–", failed: "✗" } as const;
    ctx.ui.report(
      STEPS.map((step) => {
        const result = results[step];
        const value = result.status === "failed" ? "not done" : (result.detail ?? result.status);
        return `${mark[result.status]} ${STEP_LABEL[step]}  ${value}`;
      }).join("\n"),
    );
    if (failed.length === 0) ctx.ui.success(`Apple is connected for \`${resolved.name}\`.`);
    else ctx.ui.warn("Partly done. What succeeded was saved; fix the items above and run it again.");
  }
  if (failed.length > 0) ctx.fail();
}
