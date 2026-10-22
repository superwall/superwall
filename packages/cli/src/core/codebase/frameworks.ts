import { Integration } from "@/environment";

export interface Framework {
  integration: Integration;
  name: string;
  supported: boolean;
  sdkPackage: string;
  docsUrl: string;
}

export const frameworkByIntegration: Record<Integration, Framework> = {
  [Integration.swift]: {
    integration: Integration.swift,
    name: "Swift (iOS)",
    supported: true,
    sdkPackage: "https://github.com/superwall/Superwall-iOS",
    docsUrl: "https://superwall.com/docs/ios/quickstart/install",
  },
  [Integration.android]: {
    integration: Integration.android,
    name: "Android (Kotlin)",
    supported: true,
    sdkPackage: "com.superwall.sdk:superwall-android",
    docsUrl: "https://superwall.com/docs/android/quickstart/install",
  },
  [Integration.expo]: {
    integration: Integration.expo,
    name: "Expo (React Native)",
    supported: true,
    sdkPackage: "expo-superwall",
    docsUrl: "https://superwall.com/docs/expo",
  },
  [Integration.reactNative]: {
    integration: Integration.reactNative,
    name: "React Native",
    supported: true,
    sdkPackage: "expo-superwall",
    docsUrl: "https://superwall.com/docs/expo/guides/using-expo-sdk-in-bare-react-native",
  },
  [Integration.flutter]: {
    integration: Integration.flutter,
    name: "Flutter",
    supported: true,
    sdkPackage: "superwallkit_flutter",
    docsUrl: "https://superwall.com/docs/flutter",
  },
  [Integration.web]: {
    integration: Integration.web,
    name: "Web",
    supported: false,
    sdkPackage: "@superwall/web",
    docsUrl: "https://superwall.com/docs/web",
  },
};

const supportedNames = Object.values(frameworkByIntegration)
  .filter((f) => f.supported)
  .map((f) => f.name);

export const SUPPORTED_LABEL = `${supportedNames.slice(0, -1).join(", ")}, or ${supportedNames.at(-1)}`;
