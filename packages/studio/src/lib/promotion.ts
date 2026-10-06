import type { StudioVersion } from "./contract";

export type PromotionDirection = "promote" | "rollback";

export type Promotion = {
  target?: number;
  live?: number;
  versions: StudioVersion[];
  pick?: (version: number) => void;
};

export const liveVersion = (versions: readonly StudioVersion[]): number | undefined =>
  versions.find((entry) => entry.live)?.version;

export const latestVersion = (versions: readonly StudioVersion[]): number | undefined =>
  versions.length === 0 ? undefined : Math.max(...versions.map((entry) => entry.version));

export const promotionDirection = (
  target: number | undefined,
  live: number | undefined,
): PromotionDirection =>
  target !== undefined && live !== undefined && target < live ? "rollback" : "promote";

export const PROMOTION_LABEL: Record<PromotionDirection, { label: string; running: string }> = {
  promote: { label: "Promote", running: "Promoting…" },
  rollback: { label: "Roll back", running: "Rolling back…" },
};

export const promotionHint = (promotion: Pick<Promotion, "target" | "live">): string => {
  const { target, live } = promotion;
  if (target === undefined) return "Make the latest push live";
  if (live === undefined) return `Make v${target} live`;
  if (target === live) return `v${live} is live today`;
  return target < live
    ? `Make v${target} live again, replacing v${live}`
    : `Make v${target} live, replacing v${live}`;
};

export const promotionBlocker = (
  promotion: Pick<Promotion, "target" | "live" | "versions">,
): string | undefined => {
  if (promotion.versions.length === 0) return "Nothing has been pushed yet";
  if (promotion.target !== undefined && promotion.target === promotion.live) {
    return `v${promotion.live} is already live`;
  }
  return undefined;
};
