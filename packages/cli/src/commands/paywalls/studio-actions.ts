import { promotePaywallVersion, pushPaywallVersion } from "@/core/api/resources";
import type { SuperwallApi } from "@/core/api/client";
import { resolveBinding } from "@/core/paywalls/binding";
import { readLock } from "@/core/paywalls/lock";
import { requireApi } from "@/core/paywalls/session";
import type {
  Framework,
  FrameworkProject,
  FrameworkSurface,
  StudioActions,
} from "@/core/paywalls/framework";

export function createStudioActions(
  framework: Framework,
  project: FrameworkProject,
): StudioActions {
  let api: SuperwallApi | undefined;
  const ensureApi = async () => (api ??= await requireApi(false));

  return {
    async run(action, surface, onProgress = () => {}) {
      const step = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
        onProgress(name, "start");
        const value = await work();
        onProgress(name, "done");
        return value;
      };

      try {
        const client = await ensureApi();

        if (action === "promote") {
          const binding = await step("link", () =>
            resolveBinding({ api: client, superwallDir: project.superwallDir, surface, create: false }),
          );
          const promoted = await step("promote", () =>
            promotePaywallVersion(client, binding.paywallId),
          );
          return { ok: true, version: promoted.version, live: true };
        }

        const built = await step("build", () => framework.buildSnapshot(project, surface));
        const binding = await step("link", () =>
          resolveBinding({ api: client, superwallDir: project.superwallDir, surface }),
        );
        const pushed = await step("push", () =>
          pushPaywallVersion(client, binding.paywallId, { html: built.html, surface: surface.id }),
        );
        if (action === "publish") {
          await step("promote", () =>
            promotePaywallVersion(client, binding.paywallId, { version: pushed.version }),
          );
          return { ok: true, version: pushed.version, live: true };
        }
        return { ok: true, version: pushed.version, live: false };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    async status(surface: FrameworkSurface) {
      try {
        const lock = readLock(project.superwallDir);
        const bound = (surface.kind === "paywall" ? lock.paywalls : lock.funnels)[surface.id];
        if (!bound) return {};
        const client = await ensureApi();
        const paywall = await client.get<{
          paywall_url?: string | null;
          status?: string;
          updated_at?: string;
        }>(`/v2/paywalls/${encodeURIComponent(bound.paywallId)}`);
        return {
          paywallId: bound.paywallId,
          liveUrl: paywall.paywall_url ?? undefined,
          active: paywall.status === "active",
          updatedAt: paywall.updated_at,
        };
      } catch {
        return {};
      }
    },
  };
}
