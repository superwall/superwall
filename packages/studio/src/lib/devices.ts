export type DeviceChromeSpec = {
  radius: number;
  cutout?: "island" | "punch";
  statusBarHeight: number;
  homeIndicator: boolean;
};

export type StudioDevice = {
  id: string;
  name: string;
  width: number;
  height: number;
  device?: {
    platform: "iOS" | "Android";
    deviceModel: string;
    osVersion: string;
  };
  chrome?: DeviceChromeSpec;
};

const IPHONE_ISLAND: DeviceChromeSpec = {
  radius: 54,
  cutout: "island",
  statusBarHeight: 64,
  homeIndicator: true,
};

export const STUDIO_DEVICES: readonly [StudioDevice, ...StudioDevice[]] = [
  {
    id: "iphone-se",
    name: "iPhone SE",
    width: 375,
    height: 667,
    device: { platform: "iOS", deviceModel: "iPhone14,6", osVersion: "26.0" },
    chrome: { radius: 0, statusBarHeight: 20, homeIndicator: false },
  },
  {
    id: "iphone-17",
    name: "iPhone 17",
    width: 402,
    height: 874,
    device: { platform: "iOS", deviceModel: "iPhone18,3", osVersion: "26.0" },
    chrome: IPHONE_ISLAND,
  },
  {
    id: "iphone-air",
    name: "iPhone Air",
    width: 420,
    height: 912,
    device: { platform: "iOS", deviceModel: "iPhone18,4", osVersion: "26.0" },
    chrome: IPHONE_ISLAND,
  },
  {
    id: "iphone-17-pro-max",
    name: "iPhone 17 Pro Max",
    width: 440,
    height: 956,
    device: { platform: "iOS", deviceModel: "iPhone18,2", osVersion: "26.0" },
    chrome: IPHONE_ISLAND,
  },
  {
    id: "pixel-10",
    name: "Pixel 10",
    width: 412,
    height: 915,
    device: { platform: "Android", deviceModel: "Pixel 10", osVersion: "16" },
    chrome: { radius: 28, cutout: "punch", statusBarHeight: 48, homeIndicator: true },
  },
  {
    id: "galaxy-s25",
    name: "Galaxy S25",
    width: 360,
    height: 780,
    device: { platform: "Android", deviceModel: "SM-S931B", osVersion: "15" },
    chrome: { radius: 26, cutout: "punch", statusBarHeight: 40, homeIndicator: true },
  },
  {
    id: "ipad-mini",
    name: "iPad mini",
    width: 744,
    height: 1133,
    device: { platform: "iOS", deviceModel: "iPad14,1", osVersion: "26.0" },
    chrome: { radius: 21, statusBarHeight: 24, homeIndicator: true },
  },
  {
    id: "ipad-pro-11",
    name: "iPad Pro 11″",
    width: 834,
    height: 1194,
    device: { platform: "iOS", deviceModel: "iPad16,3", osVersion: "26.0" },
    chrome: { radius: 18, statusBarHeight: 24, homeIndicator: true },
  },
  {
    id: "desktop",
    name: "Desktop",
    width: 1440,
    height: 900,
  },
];

export const DEFAULT_DEVICE_ID = "iphone-17";

export const RESPONSIVE_ID = "responsive";
export const RESPONSIVE_DEFAULT = { width: 393, height: 852 };

const DEFAULT_DEVICE: StudioDevice =
  STUDIO_DEVICES.find((device) => device.id === DEFAULT_DEVICE_ID) ?? STUDIO_DEVICES[0];

export const deviceById = (id: string): StudioDevice =>
  STUDIO_DEVICES.find((device) => device.id === id) ?? DEFAULT_DEVICE;
