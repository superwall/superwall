const IN_APP_BROWSERS: ReadonlyArray<readonly [name: string, pattern: RegExp]> = [
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

export const inAppBrowserOf = (userAgent: string): string =>
  IN_APP_BROWSERS.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? "none";

export const inAppBrowser = (): string =>
  typeof navigator === "undefined" ? "none" : inAppBrowserOf(navigator.userAgent ?? "");
