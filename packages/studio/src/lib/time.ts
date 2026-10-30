const UNITS: [number, Intl.RelativeTimeFormatUnit][] = [
  [60, "second"],
  [60, "minute"],
  [24, "hour"],
  [7, "day"],
  [4.348, "week"],
  [12, "month"],
];

const relative = (seconds: number): string => {
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const sign = Math.sign(seconds) || 1;
  let value = Math.abs(seconds);
  for (const [factor, unit] of UNITS) {
    if (value < factor) return formatter.format(sign * Math.round(value), unit);
    value /= factor;
  }
  return formatter.format(sign * Math.round(value), "year");
};

export const timeAgo = (iso: string, now = Date.now()): string | undefined => {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return undefined;
  return relative(-Math.max(0, (now - then) / 1000));
};

export const timeUntil = (ms: number): string => relative(Math.max(0, ms) / 1000);
