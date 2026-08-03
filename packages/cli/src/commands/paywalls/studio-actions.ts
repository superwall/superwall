import { promotePaywallVersion, pushPaywallVersion } from "@/core/api/resources";
import type { SuperwallApi } from "@/core/api/client";
import { VERSION } from "@/constants";
import { assetBaseUrl, requireAssets, syncAssets } from "@/core/paywalls/assets";
import { resolveApplicationId, resolveBinding } from "@/core/paywalls/binding/binding";
import { fetchProducts, projectForApplication } from "@/core/paywalls/products";
import { readLock } from "@/core/paywalls/project/lock";
import { requireApi } from "@/core/paywalls/project/session";
import {
  frameworkVersion,
  type Framework,
  type FrameworkProject,
  type FrameworkSurface,
  type StudioActions,
} from "@/core/paywalls/project/framework";
import { warnNotPortable } from "@/core/paywalls/source/portability";
import { collectSourceFiles } from "@/core/paywalls/source/source";
import { pushSource } from "@/core/paywalls/source/source-push";

type Sample = { properties?: Record<string, unknown>; live?: boolean };

const reason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function createStudioActions(
  framework: Framework,
  project: FrameworkProject,
): StudioActions {
  let api: SuperwallApi | undefined;
  const ensureApi = async () => (api ??= await requireApi(false));

  return {
    async samples() {
      try {
        const client = await ensureApi();
        const applicationId = await resolveApplicationId({
          api: client,
          superwallDir: project.superwallDir,
        });
        const query = `?application_id=${encodeURIComponent(applicationId)}`;
        let unreachable: string | undefined;
        const [device, user, products] = await Promise.all([
          client
            .get<Sample>(`/v2/users/device-properties-sample${query}`)
            .catch(() => undefined),
          client.get<Sample>(`/v2/users/properties-sample${query}`).catch(() => undefined),
          projectForApplication(client, applicationId)
            .then((projectId) => (projectId ? fetchProducts(client, projectId) : undefined))
            .catch((error: unknown) => {
              unreachable = reason(error);
              return undefined;
            }),
        ]);
        return {
          device: device?.properties,
          user: user?.properties,
          products,
          live: { device: device?.live === true, user: user?.live === true },
          unreachable,
        };
      } catch (error) {
        return { unreachable: reason(error) };
      }
    },

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
            resolveBinding({
              api: client,
              superwallDir: project.superwallDir,
              surface,
              surfaces: project.surfaces,
              create: false,
            }),
          );
          const promoted = await step("promote", () =>
            promotePaywallVersion(client, binding.paywallId),
          );
          return { ok: true, version: promoted.version, live: true };
        }

        const applicationId = await step("link", () =>
          resolveApplicationId({ api: client, superwallDir: project.superwallDir }),
        );
        const built = await step("build", () =>
          framework.buildSnapshot(project, surface, { assetBaseUrl: assetBaseUrl(applicationId) }),
        );
        const binding = await resolveBinding({
          api: client,
          superwallDir: project.superwallDir,
          surface,
          name: built.name,
          surfaces: project.surfaces,
        });
        const assets = requireAssets(built);
        const synced = await step("assets", () =>
          syncAssets({ api: client, paywallId: binding.paywallId, assets }),
        );
        const pushed = await step("push", () =>
          pushPaywallVersion(client, binding.paywallId, {
            html: built.html,
            surface: surface.id,
            assets: synced.assets,
          }),
        );
        await step("source", async () => {
          const collected = await collectSourceFiles(project.superwallDir);
          if (!collected.ok) throw new Error(collected.reason);
          return pushSource({
            api: client,
            paywallId: binding.paywallId,
            applicationId: binding.applicationId,
            version: pushed.version,
            files: collected.files,
            framework: frameworkVersion(project.root),
            surface: surface.id,
            kind: surface.kind,
            snapshotId: built.snapshotId,
            cli: VERSION,
            external: [...(built.externalSources ?? [])].sort(),
          });
        });
        warnNotPortable(built.externalSources ?? []);
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
      } catch (error) {
        return { unreachable: reason(error) };
      }
    },
  };
}
