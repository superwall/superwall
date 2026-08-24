import type { LockFile } from "../lock";

export type DeviceSurface = { kind: string; id: string };

export type DeviceSurfaceProducts = Record<string, Record<string, string>>;

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
  identifier?: string;
  products?: Record<string, string>;
};

export const attachProducts = (
  manifest: { surfaces: DeviceManifestSurface[] },
  productsBySurface: DeviceSurfaceProducts,
): { surfaces: DeviceManifestSurface[] } => ({
  surfaces: manifest.surfaces.map((surface) => {
    const products = productsBySurface[`${surface.kind}/${surface.id}`];
    return products === undefined || Object.keys(products).length === 0
      ? surface
      : { ...surface, products };
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
      const binding =
        surface.kind === "funnel"
          ? project.lock.funnels[surface.id]
          : project.lock.paywalls[surface.id];
      return {
        kind: surface.kind,
        id: surface.id,
        url: `/preview/${prefix}${surface.kind}/${surface.id}`,
        ...(binding === undefined ? {} : { paywallId: binding.paywallId }),
      };
    });
  });
  return { surfaces };
};
