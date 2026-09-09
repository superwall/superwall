// Dynamic Island devices with 50px corner radius (up to iPhone 16)
const DYNAMIC_ISLAND_50PX_PREFIXES = [
  "iPhone15,2", // iPhone 14 Pro
  "iPhone15,3", // iPhone 14 Pro Max
  "iPhone15,4", // iPhone 15
  "iPhone15,5", // iPhone 15 Plus
  "iPhone16,", // iPhone 15 Pro series
  "iPhone17,", // iPhone 16 series
];

// Dynamic Island devices with 54px corner radius (iPhone 17+)
const DYNAMIC_ISLAND_54PX_PREFIXES = [
  "iPhone18,", // iPhone 17 series
  "iPhone19,", // future
  "iPhone20,", // future
  "iPhone21,", // future
];

const NOTCH_PREFIXES = [
  "iPhone10,3", // iPhone X
  "iPhone10,6", // iPhone X
  "iPhone11,", // XS, XS Max, XR
  "iPhone12,1", // 11
  "iPhone12,3", // 11 Pro
  "iPhone12,5", // 11 Pro Max
  "iPhone13,", // 12 series
  "iPhone14,2", // 13 Pro
  "iPhone14,3", // 13 Pro Max
  "iPhone14,4", // 13 mini
  "iPhone14,5", // 13
  "iPhone14,7", // 14
  "iPhone14,8", // 14 Plus
];

const NO_NOTCH_PREFIXES = [
  "iPhone1,", // iPhone, iPhone 3G
  "iPhone2,", // iPhone 3GS
  "iPhone3,", // iPhone 4
  "iPhone4,", // iPhone 4S
  "iPhone5,", // iPhone 5, 5C
  "iPhone6,", // iPhone 5S
  "iPhone7,", // iPhone 6, 6 Plus
  "iPhone8,", // iPhone 6S, 6S Plus, SE 1st gen
  "iPhone9,", // iPhone 7, 7 Plus
  "iPhone10,1", // iPhone 8
  "iPhone10,2", // iPhone 8 Plus
  "iPhone10,4", // iPhone 8
  "iPhone10,5", // iPhone 8 Plus
  "iPhone12,8", // iPhone SE 2nd gen
  "iPhone14,6", // iPhone SE 3rd gen
];

const matchesPrefix = (deviceModel: string, prefixes: readonly string[]): boolean =>
  prefixes.some((prefix) => deviceModel.startsWith(prefix));

export type DeviceStyles = {
  safeAreaOffset: string;
  borderRadius: string;
};

export const deviceStylesOf = (deviceModel: string): DeviceStyles => {
  if (deviceModel?.startsWith("iPhone")) {
    if (matchesPrefix(deviceModel, DYNAMIC_ISLAND_54PX_PREFIXES)) {
      return { safeAreaOffset: "64px", borderRadius: "54px" };
    }

    if (matchesPrefix(deviceModel, DYNAMIC_ISLAND_50PX_PREFIXES)) {
      return { safeAreaOffset: "64px", borderRadius: "50px" };
    }

    if (matchesPrefix(deviceModel, NOTCH_PREFIXES)) {
      return { safeAreaOffset: "56px", borderRadius: "44px" };
    }

    if (matchesPrefix(deviceModel, NO_NOTCH_PREFIXES)) {
      return { safeAreaOffset: "44px", borderRadius: "22px" };
    }
  }

  return { safeAreaOffset: "56px", borderRadius: "44px" };
};
