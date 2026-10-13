import type { CommandContext } from "@/command";
import { requireOrg } from "@/core/account/org";
import { ApiError } from "@/core/api/client";
import { getAppNotificationUrl, type AppRef } from "@/core/api/asc";
import { getIntegrations, RefusedByApi, type AppKeyKind } from "@/core/api/integrations";
import { blocks } from "@/output";
import { emitJson } from "@/commands/api-output";
import { chooseAppIntent, resolveApp, type ResolvedApp } from "./apple-app";
import {
  appFlags,
  chooseTeam,
  createAndSaveKey,
  KEY_KINDS,
  KEY_LABEL,
  keyAccess,
  keyRole,
  savedKey,
  signIn,
  text,
  type AppleKeyDeps,
  type StepResult,
} from "./apple-keys";
import { describeNotificationUrl, ensureNotificationUrl } from "./notification-url";

type Step = AppKeyKind | "notification_url";

const STEPS: Step[] = [...KEY_KINDS, "notification_url"];

const STEP_LABEL: Record<Step, string> = {
  ...KEY_LABEL,
  notification_url: "Server notification URL",
};

export async function setupApple(
  ctx: CommandContext<"required">,
  deps: AppleKeyDeps,
): Promise<void> {
  const { api } = ctx;
  const role = keyRole(ctx);
  const skip: Record<Step, boolean> = {
    api_key: ctx.argv["skip-api-key"] === true,
    purchase_key: ctx.argv["skip-purchase-key"] === true,
    notification_url: ctx.argv["skip-notification-url"] === true,
  };
  const flags = appFlags(ctx);

  ctx.output.render(blocks.intro("Set up Apple"));
  await requireOrg(api, ctx.interactive);
  const intent = ctx.dryRun ? undefined : await chooseAppIntent(ctx, api, flags);

  const session = await signIn(ctx, deps, "setup apple");
  if (!session) return;
  const team = await chooseTeam(ctx, session, text(ctx, "team"));
  ctx.output.render(blocks.info(`Apple team \`${team.name}\``));

  if (ctx.dryRun || !intent) {
    const access = {
      api_key: await keyAccess(ctx, session, "api_key"),
      purchase_key: await keyAccess(ctx, session, "purchase_key"),
    };
    if (ctx.json) return emitJson(ctx, { dryRun: true, team, access });
    ctx.ui.report(
      KEY_KINDS.map(
        (kind) => `${access[kind] === "ok" ? "✓" : "✗"} ${KEY_LABEL[kind]}  ${access[kind]}`,
      ).join("\n"),
    );
    ctx.ui.info("[dry-run] nothing was created or changed.");
    return;
  }

  const app: ResolvedApp = await resolveApp(ctx, api, session, intent, flags);
  const appRef: AppRef = { projectId: app.projectId, applicationId: app.applicationId };
  ctx.output.render(
    blocks.info(`${app.created ? "Created" : "Using"} \`${app.name}\`  ${app.bundleId}`),
  );

  const results: Record<Step, StepResult> = {
    api_key: { status: "skipped" },
    purchase_key: { status: "skipped" },
    notification_url: { status: "skipped" },
  };

  const saved = await getIntegrations(api, app.applicationId);
  for (const kind of KEY_KINDS) {
    if (skip[kind]) continue;
    const existing = savedKey(saved, kind);
    results[kind] = existing
      ? { status: "done", detail: `${existing.key_id} (already saved)` }
      : await createAndSaveKey(ctx, deps, api, session, app, kind, role);
  }

  let notificationUrl: string | undefined;
  if (!skip.notification_url) {
    try {
      notificationUrl = await getAppNotificationUrl(api, appRef);
      const outcome = await ensureNotificationUrl(ctx, deps.sleep, api, appRef, {
        setRevenueProvider: false,
      });
      if (outcome.status === "set" || outcome.status === "already_set") {
        results.notification_url = {
          status: "done",
          detail: outcome.status === "set" ? "set" : "already set",
        };
      } else {
        const detail = describeNotificationUrl(outcome);
        results.notification_url = { status: "failed", detail };
        if (!ctx.json) {
          ctx.ui.error(
            outcome.status === "conflict"
              ? `${detail}\nApple allows one URL per environment. To switch, clear it in App Store Connect → App Information → App Store Server Notifications, then run this again.`
              : detail,
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
    if (failed.length === 0) ctx.ui.success(`Apple is connected for \`${app.name}\`.`);
    else ctx.ui.warn("Partly done. What succeeded was saved; fix the items above and run it again.");
  }
  if (failed.length > 0) process.exitCode = 1;
}
