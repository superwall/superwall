const UNITS: [number, Intl.RelativeTimeFormatUnit][] = [
  [60, "second"],
  [60, "minute"],
  [24, "hour"],
  [7, "day"],
  [4.348, "week"],
  [12, "month"],
  [Number.POSITIVE_INFINITY, "year"],
];

export const timeAgo = (iso: string, now = Date.now()): string | undefined => {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return undefined;
  let value = Math.max(0, (now - then) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [factor, unit] of UNITS) {
    if (value < factor) return formatter.format(-Math.round(value), unit);
    value /= factor;
  }
  return undefined;
};
