export type SafeAreaInsets = { top: number; right: number; bottom: number; left: number };

export type DeviceChromeSpec = {
  radius: number;
  cutout?: "island" | "punch";
  duo?: "closed" | "open";
  statusBarHeight: number;
  homeIndicator: boolean;
  navigationBarHeight?: number;
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
    interfaceType?: string;
  };
  chrome?: DeviceChromeSpec;
  safeArea?: { portrait: SafeAreaInsets; landscape: SafeAreaInsets };
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
    id: "iphone-17-pro",
    name: "iPhone 17 Pro",
    width: 402,
    height: 874,
    device: { platform: "iOS", deviceModel: "iPhone18,1", osVersion: "26.0" },
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
    id: "iphone-duo-closed",
    name: "iPhone Duo (Closed)",
    width: 466,
    height: 678,
    device: { platform: "iOS", deviceModel: "iPhone19,4", osVersion: "27.1" },
    chrome: { radius: 40, duo: "closed", statusBarHeight: 0, homeIndicator: true },
    safeArea: {
      portrait: { top: 0, right: 84, bottom: 34, left: 0 },
      landscape: { top: 0, right: 84, bottom: 34, left: 0 },
    },
  },
  {
    id: "iphone-duo-open",
    name: "iPhone Duo (Open)",
    width: 669,
    height: 951,
    device: { platform: "iOS", deviceModel: "iPhone19,4", osVersion: "27.1" },
    chrome: { radius: 32, duo: "open", statusBarHeight: 0, homeIndicator: true },
    safeArea: {
      portrait: { top: 82, right: 0, bottom: 34, left: 0 },
      landscape: { top: 0, right: 84, bottom: 34, left: 0 },
    },
  },
  {
    id: "pixel-10",
    name: "Pixel 10",
    width: 412,
    height: 915,
    device: { platform: "Android", deviceModel: "Pixel 10", osVersion: "16" },
    chrome: {
      radius: 28,
      cutout: "punch",
      statusBarHeight: 24,
      homeIndicator: true,
      navigationBarHeight: 24,
    },
  },
  {
    id: "galaxy-s25",
    name: "Galaxy S25",
    width: 360,
    height: 780,
    device: { platform: "Android", deviceModel: "SM-S931B", osVersion: "15" },
    chrome: {
      radius: 26,
      cutout: "punch",
      statusBarHeight: 24,
      homeIndicator: true,
      navigationBarHeight: 24,
    },
  },
  {
    id: "ipad-mini",
    name: "iPad mini",
    width: 744,
    height: 1133,
    device: { platform: "iOS", deviceModel: "iPad14,1", osVersion: "26.0", interfaceType: "ipad" },
    chrome: { radius: 21, statusBarHeight: 24, homeIndicator: true },
  },
  {
    id: "ipad-pro-11",
    name: "iPad Pro 11″",
    width: 834,
    height: 1194,
    device: { platform: "iOS", deviceModel: "iPad16,3", osVersion: "26.0", interfaceType: "ipad" },
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

export const isWebOnly = (platforms: readonly string[] | undefined): boolean =>
  platforms !== undefined &&
  platforms.length > 0 &&
  platforms.every((platform) => platform.toLowerCase() === "web");

export const chromeFor = (device: StudioDevice, web: boolean): DeviceChromeSpec | undefined =>
  web ? undefined : device.chrome;

const BROWSER_CHROME = { iOS: 84, Android: 104, tablet: 66, desktop: 52 };

export const webViewportFor = (device: StudioDevice): { width: number; height: number } => {
  const statusBar = device.chrome?.statusBarHeight ?? 0;
  const bars =
    device.device === undefined
      ? BROWSER_CHROME.desktop
      : device.width >= 600
        ? BROWSER_CHROME.tablet
        : BROWSER_CHROME[device.device.platform];
  return { width: device.width, height: device.height - statusBar - bars };
};

const DESKTOP_HOST = {
  platform: "iOS",
  deviceModel: "Mac",
  osVersion: "26.0",
  interfaceType: "mac",
};

export const safeAreaFor = (device: StudioDevice, landscape: boolean): SafeAreaInsets | undefined =>
  device.safeArea?.[landscape ? "landscape" : "portrait"];

export const deviceVariablesFor = (
  device: StudioDevice,
  web: boolean,
  landscape = false,
): Record<string, unknown> | undefined => {
  if (web) return { ...device.device, platform: "web" };
  const safeAreaInsets = safeAreaFor(device, landscape);
  const host = device.device ?? DESKTOP_HOST;
  return safeAreaInsets === undefined ? host : { ...host, safeAreaInsets };
};

export const RESPONSIVE_ID = "responsive";
export const RESPONSIVE_DEFAULT = { width: 393, height: 852 };

const DEFAULT_DEVICE: StudioDevice =
  STUDIO_DEVICES.find((device) => device.id === DEFAULT_DEVICE_ID) ?? STUDIO_DEVICES[0];

export const deviceById = (id: string): StudioDevice =>
  STUDIO_DEVICES.find((device) => device.id === id) ?? DEFAULT_DEVICE;
