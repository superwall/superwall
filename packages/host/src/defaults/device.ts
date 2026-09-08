import type { HostVariables } from "../state";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const DEFAULT_TIMEZONE_OFFSET = -18000;

export const DEFAULT_DEVICE = {
  publicApiKey: "pk_8d21d5122bb23839a2de6c8c76975e74f85b43ab4476c039",
  platform: "iOS",
  appUserId: "44dd573cd1e849a6997a5eaf98298e47",
  aliases: ["$SuperwallAlias:00EB5C40-68A7-4778-B634-F3714D2010B9"],
  vendorId: "86A1F395-D3A3-4A1C-914A-5912EF0363E2",
  appVersion: "8.4",
  osVersion: "15.5.0",
  deviceLocale: "en_US",
  deviceModel: "iPhone10",
  deviceLanguageCode: "en",
  deviceCurrencyCode: "USD",
  deviceCurrencySymbol: "$",
  timezoneOffset: DEFAULT_TIMEZONE_OFFSET,
  radioType: "Wifi",
  interfaceStyle: "Dark",
  isLowPowerModeEnabled: 0,
  bundleId: "com.jakemor.fitnessai",
  isMac: 0,
  totalPaywallViews: 0,
  interfaceType: "iphone",
} satisfies HostVariables;

const pad = (value: number) => String(value).padStart(2, "0");

const clock = (at: Date) => {
  const date = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
  const time = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}`;
  return { date, time, dateTime: `${date}T${time}` };
};

export const derivedDeviceProperties = (
  now: number,
  timezoneOffsetSeconds: number = DEFAULT_TIMEZONE_OFFSET,
): HostVariables => {
  const installedAt = now - 5 * DAY_MS;
  const lastPaywallAt = now - 6 * 60 * MINUTE_MS;
  const utc = clock(new Date(now));
  const local = clock(new Date(now + timezoneOffsetSeconds * 1000));
  return {
    daysSinceInstall: Math.floor((now - installedAt) / DAY_MS),
    minutesSinceInstall: Math.floor((now - installedAt) / MINUTE_MS),
    appInstallDate: new Date(installedAt).toISOString(),
    daysSinceLastPaywallView: Math.floor((now - lastPaywallAt) / DAY_MS),
    minutesSinceLastPaywallView: Math.floor((now - lastPaywallAt) / MINUTE_MS),
    utcDate: utc.date,
    localDate: local.date,
    utcTime: utc.time,
    localTime: local.time,
    utcDateTime: utc.dateTime,
    localDateTime: local.dateTime,
  };
};

export const defaultDevice = (now: number = Date.now()): HostVariables => ({
  ...DEFAULT_DEVICE,
  ...derivedDeviceProperties(now, DEFAULT_DEVICE.timezoneOffset),
});
