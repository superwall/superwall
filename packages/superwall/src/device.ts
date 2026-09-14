import type { SuperwallDeviceVariables } from "@superwall/runtime";

export type DevicePlatform = "ios" | "android" | "web";
export type DeviceIdiom = "phone" | "tablet" | "desktop";
export type DeviceCutout = "none" | "notch" | "island";

const NOTCH_PREFIXES = [
  "iPhone10,3",
  "iPhone10,6",
  "iPhone11,",
  "iPhone12,1",
  "iPhone12,3",
  "iPhone12,5",
  "iPhone13,",
  "iPhone14,2",
  "iPhone14,3",
  "iPhone14,4",
  "iPhone14,5",
  "iPhone14,7",
  "iPhone14,8",
];

const FLAT_PREFIXES = [
  "iPhone1,",
  "iPhone2,",
  "iPhone3,",
  "iPhone4,",
  "iPhone5,",
  "iPhone6,",
  "iPhone7,",
  "iPhone8,",
  "iPhone9,",
  "iPhone10,1",
  "iPhone10,2",
  "iPhone10,4",
  "iPhone10,5",
  "iPhone12,8",
  "iPhone14,6",
];

const matchesPrefix = (deviceModel: string, prefixes: readonly string[]): boolean =>
  prefixes.some((prefix) => deviceModel.startsWith(prefix));

export const platformOf = (device: SuperwallDeviceVariables): DevicePlatform | undefined => {
  const platform = device.platform?.toLowerCase();
  if (platform === "ios" || platform === "android" || platform === "web") return platform;
  return undefined;
};

export const idiomOf = (device: SuperwallDeviceVariables): DeviceIdiom | undefined => {
  const interfaceType = device.interfaceType?.toLowerCase();
  if (interfaceType === "iphone") return "phone";
  if (interfaceType === "ipad") return "tablet";
  if (interfaceType === "mac" || device.isMac === true) return "desktop";

  const model = device.deviceModel ?? "";
  if (model.startsWith("iPad")) return "tablet";
  if (model.startsWith("iPhone")) return "phone";
  return undefined;
};

export const cutoutOf = (deviceModel: string | undefined): DeviceCutout | undefined => {
  if (!deviceModel?.startsWith("iPhone")) return undefined;
  if (matchesPrefix(deviceModel, FLAT_PREFIXES)) return "none";
  if (matchesPrefix(deviceModel, NOTCH_PREFIXES)) return "notch";
  return "island";
};
