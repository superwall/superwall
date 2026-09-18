import { cutoutOf } from "../../device";

const DYNAMIC_ISLAND_54PX_PREFIXES = ["iPhone18,", "iPhone19,", "iPhone20,", "iPhone21,"];

export type DeviceStyles = {
  safeAreaOffset: string;
  borderRadius: string;
};

export const deviceStylesOf = (deviceModel: string): DeviceStyles => {
  switch (cutoutOf(deviceModel)) {
    case "island":
      return DYNAMIC_ISLAND_54PX_PREFIXES.some((prefix) => deviceModel.startsWith(prefix))
        ? { safeAreaOffset: "64px", borderRadius: "54px" }
        : { safeAreaOffset: "64px", borderRadius: "50px" };
    case "notch":
      return { safeAreaOffset: "56px", borderRadius: "44px" };
    case "none":
      return { safeAreaOffset: "44px", borderRadius: "22px" };
    default:
      return { safeAreaOffset: "56px", borderRadius: "44px" };
  }
};
