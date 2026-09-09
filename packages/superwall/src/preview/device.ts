import type { PaywallSettings } from "../build/settings";
import { boundPaywallIds, type LockFile } from "../lock";

export type DeviceSurface = { kind: string; id: string };

export type DeviceSurfaceDetails = Record<
  string,
  { products: Record<string, string>; settings: PaywallSettings }
>;

export type DeviceManifestProject = {
  slug: string;
  surfaces: readonly DeviceSurface[];
  lock: LockFile;
};

export type DeviceManifestSurface = {
  kind: string;
  id: string;
  url: string;
  paywallId?: string;
  paywallIds?: string[];
  identifier?: string;
  products?: Record<string, string>;
  settings?: PaywallSettings;
};

export const surfaceDetailsFrom = (
  surfaces: readonly {
    kind: string;
    id: string;
    products: Record<string, string>;
    settings: PaywallSettings;
  }[],
): DeviceSurfaceDetails =>
  Object.fromEntries(
    surfaces.map((surface) => [
      `${surface.kind}/${surface.id}`,
      { products: surface.products, settings: surface.settings },
    ]),
  );

export const attachSurfaceDetails = (
  manifest: { surfaces: DeviceManifestSurface[] },
  detailsBySurface: DeviceSurfaceDetails,
): { surfaces: DeviceManifestSurface[] } => ({
  surfaces: manifest.surfaces.map((surface) => {
    const details = detailsBySurface[`${surface.kind}/${surface.id}`];
    if (details === undefined) return surface;
    return {
      ...surface,
      ...(Object.keys(details.products).length === 0 ? {} : { products: details.products }),
      settings: details.settings,
    };
  }),
});

export const attachIdentifiers = (
  manifest: { surfaces: DeviceManifestSurface[] },
  identifiersByPaywallId: Record<string, string>,
): { surfaces: DeviceManifestSurface[] } => ({
  surfaces: manifest.surfaces.map((surface) => {
    const identifier =
      surface.paywallId === undefined ? undefined : identifiersByPaywallId[surface.paywallId];
    return identifier === undefined ? surface : { ...surface, identifier };
  }),
});

export const buildDeviceManifest = (
  projects: readonly DeviceManifestProject[],
): { surfaces: DeviceManifestSurface[] } => {
  const many = projects.length > 1;
  const surfaces = projects.flatMap((project) => {
    const prefix = many ? `${project.slug}/` : "";
    return project.surfaces.map((surface) => {
      const paywallIds = boundPaywallIds(
        surface.kind === "funnel"
          ? project.lock.funnels[surface.id]
          : project.lock.paywalls[surface.id],
      );
      const [paywallId] = paywallIds;
      return {
        kind: surface.kind,
        id: surface.id,
        url: `/preview/${prefix}${surface.kind}/${surface.id}`,
        ...(paywallId === undefined ? {} : { paywallId }),
        ...(paywallIds.length > 1 ? { paywallIds } : {}),
      };
    });
  });
  return { surfaces };
};
