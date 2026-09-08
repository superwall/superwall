export const SUPERWALL_PLATFORMS = ["ios", "android", "web"] as const;

export type SuperwallPlatform = (typeof SUPERWALL_PLATFORMS)[number];

export const normalizePlatform = (value: string | undefined): SuperwallPlatform | undefined => {
  const normalized = (value ?? "").toLowerCase();
  return SUPERWALL_PLATFORMS.find((platform) => platform === normalized);
};
