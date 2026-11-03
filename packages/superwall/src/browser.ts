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

export type SuperwallBrowser =
  | SuperwallInAppBrowser
  | "safari"
  | "chrome"
  | "firefox"
  | "edge"
  | "samsung"
  | "opera";

type Rule = readonly [name: SuperwallBrowser, pattern: RegExp];

const IN_APP_BROWSERS: ReadonlyArray<Rule> = [
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

const BROWSERS: ReadonlyArray<Rule> = [
  ["edge", /\bEdg(?:e|iOS|A)?\//],
  ["opera", /\bOPR\/|\bOPiOS\//],
  ["samsung", /\bSamsungBrowser\//],
  ["firefox", /\bFirefox\/|\bFxiOS\//],
  ["chrome", /\bChrome\/|\bCriOS\//],
  ["safari", /\bVersion\/[\d.]+.*\bSafari\//],
];

const match = (rules: ReadonlyArray<Rule>, userAgent: string) =>
  rules.find(([, pattern]) => pattern.test(userAgent))?.[0];

const IN_APP: ReadonlySet<SuperwallBrowser> = new Set(IN_APP_BROWSERS.map(([name]) => name));

export const isInAppBrowser = (browser: SuperwallBrowser | undefined): boolean =>
  browser !== undefined && IN_APP.has(browser);

const ANDROID_WEBVIEW = /; wv\)/;

export const browserOf = (userAgent: string): SuperwallBrowser | undefined =>
  match(IN_APP_BROWSERS, userAgent) ??
  (ANDROID_WEBVIEW.test(userAgent) ? undefined : match(BROWSERS, userAgent));

export const currentBrowser = (): SuperwallBrowser | undefined =>
  browserOf(globalThis.navigator?.userAgent ?? "");
