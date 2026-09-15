import * as fs from "node:fs";
import * as path from "node:path";
import fg from "fast-glob";
import type { ScreenFramework } from "./project/lock";

export type ScreenActionKind =
  | "purchase"
  | "restore"
  | "open-url"
  | "store-review"
  | "notifications"
  | "dismiss"
  | "navigate"
  | "tap";

export interface ScreenAction {
  kind: ScreenActionKind;
  count: number;
}

export interface ScreenInventory {
  copy: string[];
  interpolations: string[];
  assets: string[];
  symbols: string[];
  urls: string[];
  productIds: string[];
  actions: ScreenAction[];
}

export interface ScreenSource {
  file: string;
  path: string;
  framework: ScreenFramework;
  name: string;
  slug: string;
  placement: string;
  inventory: ScreenInventory;
  companions: string[];
}

export interface ScreenCandidate {
  path: string;
  framework: ScreenFramework;
  name: string;
  reason: string;
  score: number;
}

const SCREEN_EXTENSIONS: Record<string, "swift" | "kotlin" | "js" | "dart"> = {
  ".swift": "swift",
  ".kt": "kotlin",
  ".tsx": "js",
  ".jsx": "js",
  ".ts": "js",
  ".js": "js",
  ".dart": "dart",
};

const NAME_SUFFIXES = /^(View|Screen|Controller|Page|Sheet|Modal|Widget|Route|Scene|Component|Activity|Fragment|Dialog)$/;

export function screenNameOf(file: string): string {
  const stem = path.basename(file).replace(/\.[^.]+$/, "");
  const words = stem
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter((word) => word !== "");
  while (words.length > 1 && NAME_SUFFIXES.test(words[words.length - 1]!.replace(/^./, (c) => c.toUpperCase()))) {
    words.pop();
  }
  if (words.length === 0) return "Screen";
  return words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}

export const slugOfName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "screen";

export const placementOfName = (name: string): string => slugOfName(name).replace(/-/g, "_");

export function screenFrameworkOf(file: string, source: string): ScreenFramework {
  const language = SCREEN_EXTENSIONS[path.extname(file).toLowerCase()];
  if (language === "swift") {
    if (/\bimport SwiftUI\b/.test(source) && /:\s*(some\s+)?View\b/.test(source)) return "swiftui";
    if (/UIViewController|UIView\b/.test(source)) return "uikit";
    throw new Error(
      `\`${path.basename(file)}\` has no SwiftUI View or UIViewController in it — pass the file that draws the screen.`,
    );
  }
  if (language === "kotlin") {
    if (/@Composable\b/.test(source)) return "compose";
    if (/\b(Activity|Fragment|DialogFragment|BottomSheetDialogFragment)\b|setContentView\(/.test(source)) return "android-views";
    throw new Error(
      `\`${path.basename(file)}\` has no Composable, Activity or Fragment in it — pass the file that draws the screen.`,
    );
  }
  if (language === "js") {
    if (/<[A-Za-z][\w.]*[\s/>]/.test(source)) return "react-native";
    throw new Error(
      `\`${path.basename(file)}\` renders no JSX — pass the component file that draws the screen.`,
    );
  }
  if (language === "dart") {
    if (/Widget\b/.test(source)) return "flutter";
    throw new Error(
      `\`${path.basename(file)}\` builds no Widget — pass the file that draws the screen.`,
    );
  }
  throw new Error(
    `Can't read \`${path.basename(file)}\` as a screen — pass a SwiftUI or UIKit (.swift), Kotlin (.kt), React Native (.tsx) or Flutter (.dart) file.`,
  );
}

interface Literal {
  value: string;
  before: string;
}

const CONTEXT = 48;

const quotesOf = (framework: ScreenFramework): string[] =>
  framework === "swiftui" || framework === "uikit" || framework === "compose" || framework === "android-views"
    ? ['"""', '"']
    : ["'''", '"""', "'", '"', "`"];

function literalsOf(source: string, framework: ScreenFramework): { literals: Literal[]; code: string } {
  const quotes = quotesOf(framework);
  const literals: Literal[] = [];
  let code = "";
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    const quote = quotes.find((candidate) => source.startsWith(candidate, index));
    if (quote === undefined) {
      code += source[index];
      index += 1;
      continue;
    }
    let cursor = index + quote.length;
    let value = "";
    let closed = false;
    while (cursor < source.length) {
      if (source[cursor] === "\\") {
        value += source.slice(cursor, cursor + 2);
        cursor += 2;
        continue;
      }
      if (source.startsWith(quote, cursor)) {
        closed = true;
        break;
      }
      if (quote.length === 1 && source[cursor] === "\n") break;
      value += source[cursor];
      cursor += 1;
    }
    if (closed) literals.push({ value: value.trim(), before: code.slice(-CONTEXT) });
    code += " ";
    index = closed ? cursor + quote.length : cursor;
  }
  return { literals, code };
}

const COPY_CONTEXT =
  /(Text|Button|Label|Link|Toggle|Section|Alert|NavigationLink|TextField|SecureField|Menu|Picker|DisclosureGroup|String\(localized|NSLocalizedString|\.navigationTitle|\.accessibilityLabel|\.accessibilityHint|\.help|UILabel|setTitle|\.text\s*=|\.title\s*=|title|message|subtitle|placeholder|label|semanticsLabel|tooltip|hintText|labelText|accessibilityLabel|contentDescription|headerText|children)\s*[:=(]?\s*(\{|\()?\s*$/;
const ASSET_CONTEXT = /(Image|UIImage\(named|Image\.asset|AssetImage|require|uri|ImageResource|\.font\(\.custom|Lottie|LottieView|source)\s*[:=(]?\s*(\{)?\s*$/;
const SYMBOL_CONTEXT = /(systemName|UIImage\(systemName|Icon|name)\s*[:=(]?\s*$/;
const PRODUCT_CONTEXT = /(product|sku|identifier|subscription|purchase|plan|offering|package|entitlement)\w*\s*(:\s*\w+)?\s*[:=(\[]?\s*(\[)?\s*$/i;
const REVERSE_DNS = /^[a-z][a-z0-9]*(\.[a-z0-9_-]+){2,}$/;
const SNAKE_ID = /^[a-z0-9]+(_[a-z0-9.]+)+$/;
const IDENTIFIER_LIKE = /^[A-Za-z_$][\w$.\-/]*$/;

const interpolationsIn = (value: string, framework: ScreenFramework): string[] => {
  const pattern =
    framework === "swiftui" || framework === "uikit"
      ? /\\\(([^)]*)\)/g
      : framework === "flutter" || framework === "compose" || framework === "android-views"
        ? /\$\{([^}]*)\}|\$([A-Za-z_]\w*)/g
        : /\$\{([^}]*)\}/g;
  return [...value.matchAll(pattern)].map((match) => (match[1] ?? match[2] ?? "").trim());
};

const MODULE_CONTEXT = /\b(import|from|package)\s*$/;

const looksLikeCopy = (value: string): boolean =>
  /[A-Za-z]/.test(value) &&
  !/^https?:|^itms-apps:|^mailto:|^tel:/.test(value) &&
  !IDENTIFIER_LIKE.test(value) &&
  !(/^\S+$/.test(value) && /[/:@]/.test(value)) &&
  !/<\/?[A-Za-z]|\/>/.test(value) &&
  !/^[%\\]/.test(value) &&
  !/^#[0-9a-fA-F]{3,8}$/.test(value) &&
  !/^[\d.\s+\-*/()%]+$/.test(value);

const unique = (values: string[]): string[] => [...new Set(values.filter((value) => value !== ""))];

const ACTION_PATTERNS: Record<ScreenFramework, Partial<Record<ScreenActionKind, RegExp>>> = {
  swiftui: {
    purchase: /\.purchase\(|Product\.purchase|SKPaymentQueue|\.buy\(/g,
    restore: /restorePurchases|restoreCompletedTransactions|AppStore\.sync\(/g,
    "open-url": /openURL|UIApplication\.shared\.open\(|\bLink\(/g,
    "store-review": /requestReview|SKStoreReviewController/g,
    notifications: /requestAuthorization\(options|UNUserNotificationCenter/g,
    dismiss: /\bdismiss\(\)|presentationMode\.wrappedValue\.dismiss|isPresented\s*=\s*false/g,
    navigate: /NavigationLink|navigationDestination|\.sheet\(|\.fullScreenCover\(/g,
    tap: /\bButton\s*[({]|\.onTapGesture/g,
  },
  uikit: {
    purchase: /\.purchase\(|Product\.purchase|SKPaymentQueue|\.buy\(/g,
    restore: /restorePurchases|restoreCompletedTransactions|AppStore\.sync\(/g,
    "open-url": /UIApplication\.shared\.open\(|openURL/g,
    "store-review": /requestReview|SKStoreReviewController/g,
    notifications: /requestAuthorization\(options|UNUserNotificationCenter/g,
    dismiss: /\.dismiss\(animated|popViewController/g,
    navigate: /pushViewController|\.present\(/g,
    tap: /addTarget\(|UIAction\s*[({]|UITapGestureRecognizer/g,
  },
  compose: {
    purchase: /launchBillingFlow|purchasePackage|purchaseWith|\.purchase\(/g,
    restore: /queryPurchasesAsync|restorePurchases|queryPurchases/g,
    "open-url": /Intent\.ACTION_VIEW|CustomTabsIntent|uriHandler\.openUri|LocalUriHandler/g,
    "store-review": /ReviewManager|requestReviewFlow|launchReviewFlow/g,
    notifications: /POST_NOTIFICATIONS|RequestPermission\(\)|requestPermission\(|rememberPermissionState/g,
    dismiss: /onBackPressed|popBackStack\(|\bfinish\(\)|onDismiss/g,
    navigate: /navController\.navigate\(|Intent\((?:this|context|activity),|NavHost/g,
    tap: /onClick\s*=|\.clickable\b/g,
  },
  "android-views": {
    purchase: /launchBillingFlow|purchasePackage|purchaseWith|\.purchase\(/g,
    restore: /queryPurchasesAsync|restorePurchases|queryPurchases/g,
    "open-url": /Intent\.ACTION_VIEW|CustomTabsIntent/g,
    "store-review": /ReviewManager|requestReviewFlow|launchReviewFlow/g,
    notifications: /POST_NOTIFICATIONS|RequestPermission\(\)|requestPermissions?\(/g,
    dismiss: /onBackPressed|popBackStack\(|\bfinish\(\)|\bdismiss\(\)/g,
    navigate: /navController\.navigate\(|Intent\((?:this|context|activity|requireContext\(\)),|findNavController/g,
    tap: /setOnClickListener|onClick\s*=|OnClickListener/g,
  },
  "react-native": {
    purchase: /requestPurchase|requestSubscription|purchasePackage|purchaseStoreProduct|\bpurchase\(/g,
    restore: /restorePurchases|getAvailablePurchases/g,
    "open-url": /Linking\.openURL|openBrowserAsync|openAuthSessionAsync/g,
    "store-review": /StoreReview|requestReview/g,
    notifications: /requestPermissionsAsync|requestPermissions\(|requestPermission\(/g,
    dismiss: /goBack\(\)|\.dismiss\(\)|\bpop\(\)/g,
    navigate: /navigation\.(navigate|push|replace)\(|router\.(push|replace|navigate)\(/g,
    tap: /onPress=/g,
  },
  flutter: {
    purchase: /buyNonConsumable|buyConsumable|purchasePackage|\.purchase\(/g,
    restore: /restorePurchases/g,
    "open-url": /launchUrl\(|launchUrlString\(|\blaunch\(/g,
    "store-review": /InAppReview|requestReview/g,
    notifications: /Permission\.notification|requestPermission\(/g,
    dismiss: /Navigator\.(of\(context\)\.)?pop\(|context\.pop\(/g,
    navigate: /Navigator\.(of\(context\)\.)?push|context\.(go|push)\(/g,
    tap: /onPressed:|onTap:/g,
  },
};

const jsxText = (source: string): string[] =>
  [...source.matchAll(/>\s*([^<>{}\n]*[A-Za-z][^<>{}\n]*?)\s*</g)]
    .map((match) => match[1]!.trim())
    .filter((value) => looksLikeCopy(value) || /\s/.test(value));

export function scanScreen(source: string, framework: ScreenFramework): ScreenInventory {
  const { literals, code } = literalsOf(source, framework);
  const copy: string[] = [];
  const assets: string[] = [];
  const symbols: string[] = [];
  const urls: string[] = [];
  const productIds: string[] = [];

  for (const { value, before } of literals) {
    if (value === "" || MODULE_CONTEXT.test(before) || /<\/?[A-Za-z]|\/>/.test(value)) continue;
    if (/^(https?:|itms-apps:|mailto:|tel:|market:)/.test(value)) {
      urls.push(value);
      continue;
    }
    if (SYMBOL_CONTEXT.test(before) && /^[a-z0-9]+(\.[a-z0-9]+)*$/i.test(value)) {
      symbols.push(value);
      continue;
    }
    if (ASSET_CONTEXT.test(before) || /\.(png|jpe?g|gif|webp|svg|json|lottie|riv|mp4|ttf|otf)$/i.test(value)) {
      assets.push(value);
      continue;
    }
    if (REVERSE_DNS.test(value) || (PRODUCT_CONTEXT.test(before) && (SNAKE_ID.test(value) || /\./.test(value)) && !/\s/.test(value))) {
      productIds.push(value);
      continue;
    }
    if (COPY_CONTEXT.test(before) ? /[A-Za-z]/.test(value) : looksLikeCopy(value)) {
      copy.push(value);
    }
  }
  if (framework === "react-native") copy.push(...jsxText(source));

  const actions: ScreenAction[] = [];
  const lines = code.split("\n").filter((line) => !/^\s*(import|package)\b/.test(line));
  for (const [kind, pattern] of Object.entries(ACTION_PATTERNS[framework]) as [ScreenActionKind, RegExp][]) {
    const count = lines.filter((line) => new RegExp(pattern.source).test(line)).length;
    if (count > 0) actions.push({ kind, count });
  }

  const uniqueCopy = unique(copy);
  return {
    copy: uniqueCopy,
    interpolations: unique(uniqueCopy.flatMap((value) => interpolationsIn(value, framework))),
    assets: unique(assets),
    symbols: unique(symbols),
    urls: unique(urls),
    productIds: unique(productIds),
    actions,
  };
}

const mergeInventories = (inventories: ScreenInventory[]): ScreenInventory => {
  const counts = new Map<ScreenActionKind, number>();
  for (const inventory of inventories) {
    for (const action of inventory.actions) counts.set(action.kind, (counts.get(action.kind) ?? 0) + action.count);
  }
  return {
    copy: unique(inventories.flatMap((entry) => entry.copy)),
    interpolations: unique(inventories.flatMap((entry) => entry.interpolations)),
    assets: unique(inventories.flatMap((entry) => entry.assets)),
    symbols: unique(inventories.flatMap((entry) => entry.symbols)),
    urls: unique(inventories.flatMap((entry) => entry.urls)),
    productIds: unique(inventories.flatMap((entry) => entry.productIds)),
    actions: [...counts.entries()].map(([kind, count]) => ({ kind, count })),
  };
};

const decodeXml = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#10;/g, "\n")
    .replace(/&amp;/g, "&");

export function scanInterfaceBuilder(xml: string, classes: string[]): ScreenInventory {
  const scenes = xml.includes("<scene")
    ? [...xml.matchAll(/<scene[\s\S]*?<\/scene>/g)]
        .map((match) => match[0])
        .filter((scene) => classes.some((name) => scene.includes(`customClass="${name}"`)))
    : [xml];
  const text = scenes.join("\n");
  const copy = [...text.matchAll(/\b(?:text|title|placeholder|normalTitle|value)="([^"]*)"/g)]
    .map((match) => decodeXml(match[1]!).trim())
    .filter((value) => /[A-Za-z]/.test(value));
  const assets = [...text.matchAll(/\bimage="([^"]*)"/g)].map((match) => match[1]!);
  const symbols = [...text.matchAll(/\bcatalog="system"[^>]*\bimage="([^"]*)"|\bimage="([^"]*)"[^>]*\bcatalog="system"/g)]
    .map((match) => match[1] ?? match[2] ?? "");
  const taps = (text.match(/<button\b/g) ?? []).length;
  return {
    copy: unique(copy),
    interpolations: [],
    assets: unique(assets.filter((asset) => !symbols.includes(asset))),
    symbols: unique(symbols),
    urls: [],
    productIds: [],
    actions: taps > 0 ? [{ kind: "tap", count: taps }] : [],
  };
}

const COMPANION_TYPES = /\b([A-Z][A-Za-z0-9]*(?:View|ViewModel|Cell|Presenter|Model))\b/g;
const SYSTEM_PREFIX = /^(UI|NS|SwiftUI|Any|Some|CG|CA|SK|AV|WK|MK)/;
const MAX_COMPANIONS = 8;

function companionsOf(searchRoot: string, primary: string, source: string): string[] {
  const stem = path.basename(primary).replace(/\.[^.]+$/, "");
  const names = unique([...source.matchAll(COMPANION_TYPES)].map((match) => match[1]!)).filter(
    (name) => name !== stem && !SYSTEM_PREFIX.test(name),
  );
  const options = { cwd: searchRoot, ignore: CANDIDATE_IGNORE, onlyFiles: true, followSymbolicLinks: false };
  const swift =
    names.length === 0 ? [] : fg.sync(`**/@(${names.join("|")}).swift`, options).map((file) => path.join(searchRoot, file));
  const classes = [stem, ...names];
  const interfaceBuilder = fg
    .sync("**/*.{xib,storyboard}", options)
    .map((file) => path.join(searchRoot, file))
    .filter((file) => {
      try {
        if (fs.statSync(file).size > MAX_CANDIDATE_BYTES * 5) return false;
        const xml = fs.readFileSync(file, "utf8");
        return classes.some((name) => xml.includes(`customClass="${name}"`));
      } catch {
        return false;
      }
    });
  return unique([...swift, ...interfaceBuilder])
    .filter((file) => file !== primary)
    .sort()
    .slice(0, MAX_COMPANIONS);
}

const EMPTY_INVENTORY: ScreenInventory = {
  copy: [],
  interpolations: [],
  assets: [],
  symbols: [],
  urls: [],
  productIds: [],
  actions: [],
};

const ANDROID_RESOURCE_TYPES = /\b(ViewModel|Presenter|State|Model)\b/;

function androidCompanionsOf(searchRoot: string, primary: string, source: string): string[] {
  const options = { cwd: searchRoot, ignore: CANDIDATE_IGNORE, onlyFiles: true, followSymbolicLinks: false };
  const stem = path.basename(primary, ".kt");
  const layouts = unique([...source.matchAll(/R\.layout\.(\w+)/g)].map((match) => match[1]!));
  const layoutFiles =
    layouts.length === 0 ? [] : fg.sync(`**/res/layout*/@(${layouts.join("|")}).xml`, options);
  const names = unique([...source.matchAll(COMPANION_TYPES)].map((match) => match[1]!)).filter(
    (name) => name !== stem && !SYSTEM_PREFIX.test(name) && ANDROID_RESOURCE_TYPES.test(name),
  );
  const kotlin = names.length === 0 ? [] : fg.sync(`**/@(${names.join("|")}).kt`, options);
  const usesStrings = /R\.string\.\w+/.test(source) || layoutFiles.length > 0;
  const strings = usesStrings ? fg.sync("**/res/values/strings.xml", options) : [];
  return unique([...layoutFiles, ...kotlin, ...strings].map((file) => path.join(searchRoot, file)))
    .filter((file) => file !== primary)
    .sort()
    .slice(0, MAX_COMPANIONS);
}

function androidStringsOf(companions: string[]): Map<string, string> {
  const strings = new Map<string, string>();
  for (const file of companions) {
    if (!file.endsWith("strings.xml")) continue;
    let xml: string;
    try {
      xml = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of xml.matchAll(/<string\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g)) {
      strings.set(match[1]!, decodeXml(match[2]!.trim()).replace(/^"|"$/g, "").replace(/\\'/g, "'"));
    }
  }
  return strings;
}

const withResolvedStrings = (
  inventory: ScreenInventory,
  source: string,
  strings: Map<string, string>,
): ScreenInventory => {
  const resolved = [...source.matchAll(/R\.string\.(\w+)/g)]
    .map((match) => strings.get(match[1]!))
    .filter((value): value is string => value !== undefined);
  const assets = [...source.matchAll(/R\.(?:drawable|mipmap|raw|font)\.(\w+)/g)].map((match) => match[1]!);
  const symbols = [...source.matchAll(/Icons\.(?:Default|Filled|Outlined|Rounded|Sharp|TwoTone|AutoMirrored\.\w+)\.(\w+)/g)].map(
    (match) => match[1]!,
  );
  return {
    ...inventory,
    copy: unique([...inventory.copy, ...resolved]),
    interpolations: unique([...inventory.interpolations, ...resolved.flatMap((value) => interpolationsIn(value, "compose"))]),
    assets: unique([...inventory.assets, ...assets]),
    symbols: unique([...inventory.symbols, ...symbols]),
  };
};

export function scanAndroidLayout(xml: string, strings: Map<string, string>): ScreenInventory {
  const resolve = (value: string): string | undefined => {
    const reference = /^@string\/(\w+)$/.exec(value);
    if (reference) return strings.get(reference[1]!);
    return value.startsWith("@") ? undefined : decodeXml(value);
  };
  const copy = [...xml.matchAll(/\b(?:android:text|android:hint|android:contentDescription|android:title|app:title|tools:text)="([^"]*)"/g)]
    .map((match) => resolve(match[1]!))
    .filter((value): value is string => value !== undefined && /[A-Za-z]/.test(value));
  const assets = [...xml.matchAll(/\b(?:android:src|app:srcCompat|android:background|app:lottie_rawRes|android:drawable\w*)="@(?:drawable|mipmap|raw)\/(\w+)"/g)].map(
    (match) => match[1]!,
  );
  const taps = (xml.match(/<(?:Button|ImageButton|com\.google\.android\.material\.button\.MaterialButton)\b|android:onClick=/g) ?? []).length;
  return {
    ...EMPTY_INVENTORY,
    copy: unique(copy),
    assets: unique(assets),
    actions: taps > 0 ? [{ kind: "tap", count: taps }] : [],
  };
}

export function readScreen(root: string, file: string, searchRoot?: string): ScreenSource {
  const absolute = path.resolve(root, file);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error(`No file at \`${file}\`.`);
  }
  const source = fs.readFileSync(absolute, "utf8");
  const framework = screenFrameworkOf(absolute, source);
  const name = screenNameOf(absolute);
  const relative = (target: string) => path.relative(root, target).split(path.sep).join("/");
  const android = framework === "compose" || framework === "android-views";
  const apple = framework === "uikit" || framework === "swiftui";
  const companions =
    searchRoot === undefined
      ? []
      : apple
        ? companionsOf(searchRoot, absolute, source)
        : android
          ? androidCompanionsOf(searchRoot, absolute, source)
          : [];
  const strings = android ? androidStringsOf(companions) : new Map<string, string>();
  const inventories = [
    android ? withResolvedStrings(scanScreen(source, framework), source, strings) : scanScreen(source, framework),
    ...companions.map((companion) => {
      const content = fs.readFileSync(companion, "utf8");
      if (companion.endsWith(".swift") || companion.endsWith(".kt")) {
        const inventory = scanScreen(content, framework);
        return android ? withResolvedStrings(inventory, content, strings) : inventory;
      }
      if (android) {
        return path.basename(path.dirname(companion)).startsWith("values")
          ? EMPTY_INVENTORY
          : scanAndroidLayout(content, strings);
      }
      return scanInterfaceBuilder(content, [path.basename(absolute).replace(/\.[^.]+$/, ""), ...companions.map((entry) => path.basename(entry, ".swift"))]);
    }),
  ];
  return {
    file: absolute,
    path: relative(absolute),
    framework,
    name,
    slug: slugOfName(name),
    placement: placementOfName(name),
    inventory: mergeInventories(inventories),
    companions: companions.map(relative),
  };
}

const CANDIDATE_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.build/**",
  "**/DerivedData/**",
  "**/Pods/**",
  "**/build/**",
  "**/dist/**",
  "**/.expo/**",
  "**/vendor/**",
  "**/superwall/**",
  "**/paywalls/**",
  "**/*Tests/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.stories.*",
  "**/*.d.ts",
];

const NAME_SIGNALS: Array<{ pattern: RegExp; weight: number; reason: string }> = [
  { pattern: /\b(update|upgrade|force|forced|outdated|version)\b/, weight: 3, reason: "named like an update-required screen" },
  { pattern: /\b(onboarding|onboard|welcome|intro|get started|tutorial|quiz)\b/, weight: 2, reason: "named like an onboarding screen" },
  { pattern: /\b(paywall|subscribe|subscription|premium|pro|plan|plans|pricing|offer|trial|checkout|unlock)\b/, weight: 2, reason: "named like a paywall or offer" },
  { pattern: /\b(rate|rating|review|feedback)\b/, weight: 2, reason: "named like a rate-us prompt" },
  { pattern: /\b(notification|notifications|permission|permissions|push)\b/, weight: 2, reason: "named like a permission prompt" },
  { pattern: /\b(announcement|whats new|changelog|news|promo|banner)\b/, weight: 2, reason: "named like an announcement" },
  { pattern: /\b(consent|privacy|terms|legal|gdpr)\b/, weight: 1, reason: "named like a consent screen" },
  { pattern: /\b(winback|win back|discount|cancel|churn|retention)\b/, weight: 2, reason: "named like a win-back screen" },
  { pattern: /\b(maintenance|outage|downtime)\b/, weight: 2, reason: "named like a maintenance screen" },
];

const nameWords = (file: string): string =>
  path
    .basename(file)
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .toLowerCase();

const CONTENT_SIGNALS: Array<{ pattern: RegExp; weight: number; reason: string }> = [
  { pattern: /itms-apps:|apps\.apple\.com|play\.google\.com/i, weight: 3, reason: "links to the app store" },
  { pattern: /requestReview|SKStoreReviewController|InAppReview|StoreReview|ReviewManager/i, weight: 2, reason: "asks for a store review" },
  { pattern: /requestAuthorization|requestPermissionsAsync|Permission\.notification/i, weight: 2, reason: "asks for a permission" },
  { pattern: /StoreKit|Product\.products|requestPurchase|purchasePackage|buyNonConsumable|BillingClient|launchBillingFlow/i, weight: 2, reason: "sells a product" },
  { pattern: /\b(update|upgrade)\s+(now|required|app|to continue)/i, weight: 2, reason: "update-required copy" },
];

const SCREEN_SHAPE: Record<"swift" | "kotlin" | "js" | "dart", RegExp> = {
  swift: /:\s*(some\s+)?View\b|UIViewController/,
  kotlin: /@Composable\b|\b(Activity|Fragment)\b|setContentView\(/,
  js: /<[A-Za-z][\w.]*[\s/>]/,
  dart: /Widget\b/,
};

const MAX_CANDIDATE_BYTES = 200_000;

export function findScreenCandidates(root: string, limit = 10): ScreenCandidate[] {
  const files = fg.sync("**/*.{swift,kt,tsx,jsx,dart}", {
    cwd: root,
    ignore: CANDIDATE_IGNORE,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
  });
  const candidates: ScreenCandidate[] = [];
  for (const file of files) {
    const absolute = path.join(root, file);
    let source: string;
    try {
      if (fs.statSync(absolute).size > MAX_CANDIDATE_BYTES) continue;
      source = fs.readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    const language = SCREEN_EXTENSIONS[path.extname(file).toLowerCase()];
    if (language === undefined || !SCREEN_SHAPE[language].test(source)) continue;
    const stem = nameWords(file);
    const reasons: string[] = [];
    let score = 0;
    for (const signal of NAME_SIGNALS) {
      if (signal.pattern.test(stem)) {
        score += signal.weight * 3;
        reasons.push(signal.reason);
      }
    }
    for (const signal of CONTENT_SIGNALS) {
      if (signal.pattern.test(source)) {
        score += signal.weight;
        reasons.push(signal.reason);
      }
    }
    if (score === 0) continue;
    let framework: ScreenFramework;
    try {
      framework = screenFrameworkOf(absolute, source);
    } catch {
      continue;
    }
    candidates.push({
      path: file,
      framework,
      name: screenNameOf(file),
      reason: unique(reasons).join("; "),
      score,
    });
  }
  return candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}

const literal = (value: string): string => JSON.stringify(value);

const productKeyOf = (id: string, taken: Set<string>): string => {
  const segments = id.split(/[._\-/]+/).filter((segment) => /^[A-Za-z]/.test(segment));
  let key = segments[segments.length - 1] ?? "";
  if (!/^[A-Za-z_$][\w$]*$/.test(key) || key === "") key = "product";
  let candidate = key;
  let counter = 2;
  while (taken.has(candidate)) candidate = `${key}${counter++}`;
  taken.add(candidate);
  return candidate;
};

export function screenConfigSource(screen: ScreenSource): string {
  const lines: string[] = [`  name: ${literal(screen.name)},`];
  if (screen.inventory.productIds.length > 0) {
    const taken = new Set<string>();
    lines.push(`  products: {`);
    for (const id of screen.inventory.productIds) {
      lines.push(`    ${productKeyOf(id, taken)}: ${literal(id)},`);
    }
    lines.push(`  },`);
  }
  return `import { definePaywall } from "superwall/config";\n\nexport default definePaywall({\n${lines.join("\n")}\n});\n`;
}

const FRAMEWORK_LABEL: Record<ScreenFramework, string> = {
  swiftui: "SwiftUI",
  uikit: "UIKit",
  compose: "Jetpack Compose",
  "android-views": "Android Views",
  "react-native": "React Native",
  flutter: "Flutter",
};

export const screenFrameworkLabel = (framework: ScreenFramework): string => FRAMEWORK_LABEL[framework];

const ACTION_MAPPING: Record<ScreenActionKind, [string, string]> = {
  purchase: ["a purchase", "`usePurchase()` with the product from `useProducts()`"],
  restore: ["a restore", "`useActions().restore()`"],
  "open-url": ["opening a URL (App Store links included)", "`useActions().openUrl(url)`"],
  "store-review": ["a store review request", "`useActions().requestStoreReview()`"],
  notifications: ["a permission request", "`useActions().requestPermission(\"notification\")`"],
  dismiss: ["dismissing the screen", "`useActions().close()`"],
  navigate: ["navigation to another screen", "`useRouter().push()` for a page inside this surface; otherwise close and let the app route"],
  tap: ["a tappable control", "a `<button>` calling one of the hooks above"],
};

const table = (rows: string[][]): string => rows.map((row) => `| ${row.join(" | ")} |`).join("\n");

const bulletsOr = (values: string[], empty: string, format = (value: string) => `\`${value}\``): string =>
  values.length === 0 ? `_${empty}_` : values.map((value) => `- ${format(value)}`).join("\n");

export function screenBrief(screen: ScreenSource, screenshot?: string): string {
  const { inventory } = screen;
  const copy =
    inventory.copy.length === 0
      ? "_No user-visible strings were found in the file; read it for text drawn elsewhere (localized string tables, view models)._"
      : table([
          ["#", "Text"],
          ["---", "---"],
          ...inventory.copy.map((value, index) => [String(index + 1), value.replace(/\|/g, "\\|")]),
        ]);
  const actions =
    inventory.actions.length === 0
      ? "_No actions were detected; read the file for what its controls do._"
      : table([
          ["In the source", "Count", "Becomes"],
          ["---", "---", "---"],
          ...inventory.actions.map(({ kind, count }) => [ACTION_MAPPING[kind][0], `×${count}`, ACTION_MAPPING[kind][1]]),
        ]);

  return `# Migrating "${screen.name}" to Superwall

Rebuild this ${FRAMEWORK_LABEL[screen.framework]} screen as a framework surface so
the app can change it without a release. Follow the \`superwall-framework\`
skill's \`references/migrate-from-native.md\` and its \`native/\` file for
${FRAMEWORK_LABEL[screen.framework]}; this file is their input and is
deleted when the migration is done.

## Source

- File: \`${screen.path}\` (${FRAMEWORK_LABEL[screen.framework]})${screen.companions.length === 0 ? "" : `\n- Also read (what this screen draws from: its view, view model, storyboard scene, layout or string resources; their strings and assets are in the inventory below): ${screen.companions.map((entry) => `\`${entry}\``).join(", ")}`}
- Screenshot of the original: ${screenshot ? `\`${screenshot}\` (Compare › Original in the studio)` : "none — take one in the simulator before reviewing, or pass `--screenshot` to `superwall migrate --screen`"}
- Placement to register in the app: \`${screen.placement}\`

## Copy

Every string becomes a \`messages/en.ts\` entry read with \`t()\`; dynamic
values become interpolations.

${copy}
${inventory.interpolations.length === 0 ? "" : `\nDynamic values in that copy: ${inventory.interpolations.map((value) => `\`${value}\``).join(", ")}. Each is a \`t()\` parameter; source it from a variable (\`useVariables()\`), a product (\`useProducts()\`), or a placement param.\n`}
## Assets

${bulletsOr(inventory.assets, "No image or media assets referenced.")}
${inventory.symbols.length === 0 ? "" : `\nSystem symbols: ${inventory.symbols.map((value) => `\`${value}\``).join(", ")} — replace with an SVG in \`assets/\`; there are no SF Symbols on the web.\n`}
## Links

${bulletsOr(inventory.urls, "No URLs.")}

## Products

${inventory.productIds.length === 0 ? "_No store product identifiers found; this screen sells nothing._" : `${bulletsOr(inventory.productIds, "")}\n\nThese are already slots in \`config.ts\`. Each must exist on the dashboard for the app it pushes to, or the push is refused; the user confirms the identifiers.`}

## Actions

${actions}

## Done when

- Every state and string of the source is rebuilt as pages under \`app/\`
  with the framework's hooks, and reviewed side by side against the
  screenshot in the studio, in both schemes.
- \`${screen.path}\` is untouched. Wiring the app —
  \`register("${screen.placement}")\` where it used to present this screen,
  the campaign, then deleting the native screen — is the next step, in the
  app, after the user has reviewed the rebuild.
- This file is deleted by the user after review.
`;
}
