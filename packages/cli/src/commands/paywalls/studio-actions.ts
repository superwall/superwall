import {
  listApplications,
  promotePaywallVersion,
  pushPaywallVersion,
  versionProducts,
} from "@/core/api/resources";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import { VERSION } from "@/environment";
import { assetBaseUrl, requireAssets, syncAssets } from "@/core/paywalls/assets";
import { resolveApps } from "@/core/paywalls/binding/apps";
import { resolveBinding } from "@/core/paywalls/binding/binding";
import {
  planTargets,
  wantedPlatforms,
  type SurfaceTarget,
} from "@/core/paywalls/binding/targets";
import { fetchProducts, projectForApplication } from "@/core/paywalls/products";
import { readLock } from "@/core/paywalls/project/lock";
import { collectProjectDeclarations } from "@/core/paywalls/project/types";
import {
  appScheme,
  detectAppTransportSecurity,
  schemeSearchRoots,
} from "@/core/paywalls/project/scheme";
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

const firstApp = (apps: Record<string, string>): string | undefined =>
  apps.ios ?? Object.values(apps)[0];

export function createStudioActions(
  framework: Framework,
  project: FrameworkProject,
): StudioActions {
  let api: SuperwallApi | undefined;
  const ensureApi = async () => (api ??= await requireApi(false));

  const targetsFor = async (client: SuperwallApi, surface: FrameworkSurface) => {
    const declared = (await collectProjectDeclarations(framework, project.root)).platforms;
    const apps = await resolveApps({
      api: client,
      superwallDir: project.superwallDir,
      wanted: wantedPlatforms([surface], declared),
    });
    return planTargets({ surfaces: [surface], declared, apps });
  };

  return {
    async appScheme() {
      const applicationId = firstApp(readLock(project.superwallDir).apps);
      const roots = schemeSearchRoots(project);
      const [resolved, transport] = await Promise.all([
        appScheme(roots, async () => {
          if (applicationId === undefined) return undefined;
          const client = await ensureApi();
          const applications = await listApplications(client);
          return applications.find((app) => String(app.id) === applicationId)?.apple_url_scheme;
        }),
        detectAppTransportSecurity(roots),
      ]);
      return transport === undefined || transport.allowed
        ? resolved
        : { ...resolved, blocksLocalNetworking: transport.plist };
    },

    async samples() {
      try {
        const client = await ensureApi();
        const apps = await resolveApps({ api: client, superwallDir: project.superwallDir });
        const applicationId = firstApp(apps);
        if (applicationId === undefined) return { unreachable: "This project is not bound to an app yet." };
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
        const targets = await step("link", () => targetsFor(client, surface));
        const app = (target: SurfaceTarget) => ({
          platform: target.platform,
          applicationId: target.applicationId,
        });

        if (action === "promote") {
          let version = 0;
          for (const target of targets) {
            const binding = await resolveBinding({
              api: client,
              superwallDir: project.superwallDir,
              surface,
              app: app(target),
              surfaces: project.surfaces,
              create: false,
            });
            const promoted = await step("promote", () =>
              promotePaywallVersion(client, binding.paywallId),
            );
            version = promoted.version;
          }
          return { ok: true, version, live: true };
        }

        const collected = await collectSourceFiles(project.superwallDir);
        let version = 0;
        const external = new Set<string>();
        for (const target of targets) {
          const built = await step("build", () =>
            framework.buildSnapshot(project, surface, {
              assetBaseUrl: assetBaseUrl(target.applicationId),
              platform: target.platform,
            }),
          );
          const binding = await resolveBinding({
            api: client,
            superwallDir: project.superwallDir,
            surface,
            app: app(target),
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
              products: versionProducts(built.products, target.platform),
              settings: built.settings,
            }),
          );
          await step("source", async () => {
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
          for (const source of built.externalSources ?? []) external.add(source);
          if (action === "publish") {
            await step("promote", () =>
              promotePaywallVersion(client, binding.paywallId, { version: pushed.version }),
            );
          }
          version = pushed.version;
        }
        warnNotPortable(external);
        return { ok: true, version, live: action === "publish" };
      } catch (error) {
        return { ok: false, error: reason(error) };
      }
    },

    async screenshot(surface: FrameworkSurface) {
      const lock = readLock(project.superwallDir);
      const bindings = (surface.kind === "paywall" ? lock.paywalls : lock.funnels)[surface.id];
      const bound = bindings === undefined ? undefined : Object.values(bindings)[0];
      if (!bound) return undefined;
      const client = await ensureApi();
      const session = await client
        .get<{
          status?: string;
          pages?: { url?: string }[];
          apple_review_image?: { url?: string } | null;
        }>(`/v2/paywalls/${encodeURIComponent(bound.paywallId)}/preview-images`)
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 400) return undefined;
          throw error;
        });
      if (session?.status !== "ready") return undefined;
      return session.apple_review_image?.url ?? session.pages?.[0]?.url;
    },

    async status(surface: FrameworkSurface) {
      try {
        const lock = readLock(project.superwallDir);
        const bindings = (surface.kind === "paywall" ? lock.paywalls : lock.funnels)[surface.id];
        const bound = bindings === undefined ? undefined : Object.values(bindings)[0];
        if (!bound) return {};
        const client = await ensureApi();
        const paywall = await client.get<{
          paywall_url?: string | null;
          status?: string;
          updated_at?: string;
          identifier?: string;
        }>(`/v2/paywalls/${encodeURIComponent(bound.paywallId)}`);
        return {
          paywallId: bound.paywallId,
          liveUrl: paywall.paywall_url ?? undefined,
          active: paywall.status === "active",
          updatedAt: paywall.updated_at,
          identifier: paywall.identifier,
        };
      } catch (error) {
        return { unreachable: reason(error) };
      }
    },
  };
}
