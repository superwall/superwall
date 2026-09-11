const STORAGE_KEY = "superwall-device-scheme";

export const readScheme = (): string | undefined => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

export const storeScheme = (value: string) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* private browsing */
  }
};

/**
 * The link that points a device at this machine's `superwall dev` server.
 *
 * The SDK parses `superwall_dev` as the dev server base and the optional
 * `superwall_dev_surface` as the surface to open with — see `DevServerPreview`
 * in the iOS SDK, which refuses any base that is not loopback, `.local`, or a
 * private-network address.
 */
export const devServerLink = (scheme: string, origin: string, surfaceId?: string): string => {
  const surface =
    surfaceId === undefined ? "" : `&superwall_dev_surface=${encodeURIComponent(surfaceId)}`;
  return `${scheme}://?superwall_dev=${encodeURIComponent(origin)}${surface}`;
};
