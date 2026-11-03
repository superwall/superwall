export type SuperwallInAppBrowser =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "snapchat"
  | "pinterest"
  | "linkedin"
  | "twitter"
  | "wechat"
  | "line";

const IN_APP_BROWSERS: ReadonlyArray<readonly [name: SuperwallInAppBrowser, pattern: RegExp]> = [
  ["instagram", /\bInstagram\b/],
  ["facebook", /\bFBAN\/|\bFBAV\/|\bFB_IAB\b|\bFBIOS\b/],
  ["tiktok", /musical_ly|BytedanceWebview|\bTikTok\b/i],
  ["snapchat", /\bSnapchat\b/],
  ["pinterest", /\bPinterest\b/],
  ["linkedin", /\bLinkedInApp\b/],
  ["twitter", /\bTwitter\b/],
  ["wechat", /\bMicroMessenger\b/],
  ["line", /\bLine\//],
];

export const inAppBrowserOf = (userAgent: string): SuperwallInAppBrowser | undefined =>
  IN_APP_BROWSERS.find(([, pattern]) => pattern.test(userAgent))?.[0];

export const inAppBrowser = (): SuperwallInAppBrowser | undefined =>
  typeof navigator === "undefined" ? undefined : inAppBrowserOf(navigator.userAgent ?? "");
