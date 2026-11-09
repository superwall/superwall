type Rule = { readonly methods: ReadonlySet<string>; readonly path: RegExp };

export const ARTIFACT_ROUTE_REFUSAL = "Artifacts may not call this endpoint.";

const READ = new Set(["GET", "HEAD"]);
const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const POST = new Set(["POST"]);

const ID = "[^/]+";
const under = (prefix: string): RegExp => new RegExp(`^${prefix}(?:/.*)?$`);

const READ_WRITE_FAMILIES = [
  "/v2/paywalls",
  "/v2/campaigns",
  "/v2/products",
  "/v2/entitlements",
  "/v2/grants",
  "/v2/assets",
  "/v2/surveys",
  "/v2/retention-campaigns",
  "/v2/retention-configurations",
  "/v2/retention-default-messages",
  "/v2/retention-messages",
];

const READ_FAMILIES = [
  "/v2/projects",
  "/v2/applications",
  "/v2/charts",
  "/v2/users",
  "/v3/users",
  "/v2/onboarding",
  "/v2/retention-onboarding",
  "/v2/demand-score",
];

const ALLOWED: readonly Rule[] = [
  ...READ_WRITE_FAMILIES.map((prefix) => ({ methods: READ, path: under(prefix) })),
  ...READ_WRITE_FAMILIES.map((prefix) => ({ methods: WRITE, path: under(prefix) })),
  ...READ_FAMILIES.map((prefix) => ({ methods: READ, path: under(prefix) })),
  { methods: POST, path: /^\/v2\/charts\/(?:data|filter-values|acquisition-cohort-report)$/ },
  { methods: POST, path: /^\/v2\/users\/query$/ },
  { methods: POST, path: /^\/v2\/demand-score\/query$/ },
  { methods: new Set(["GET", "HEAD", "POST"]), path: new RegExp(`^/v2/organizations/${ID}/query$`) },
  { methods: WRITE, path: new RegExp(`^/v2/projects/${ID}/custom-stores(?:/${ID})?$`) },
  { methods: POST, path: new RegExp(`^/v2/custom-stores/${ID}/events$`) },
];

const DENIED: readonly RegExp[] = [
  new RegExp(`^/v2/paywalls/${ID}/(?:source-access|preview-token)$`),
  new RegExp(`^/v2/campaigns/${ID}/audiences/${ID}/generate-rule$`),
  /^\/v2\/demand-score\/(?:ai-report|launch-experiment)$/,
  /^\/v2\/retention-onboarding\/(?:sandbox|production)(?:\/.*)?$/,
];

const NARROWED: readonly Rule[] = [
  ...[
    "/v2/campaigns",
    "/v2/surveys",
    "/v2/retention-campaigns",
    "/v2/retention-configurations",
    "/v2/retention-default-messages",
    "/v2/retention-messages",
  ].flatMap((prefix) => [
    { methods: READ, path: under(prefix) },
    { methods: WRITE, path: under(prefix) },
  ]),
  { methods: READ, path: /^\/v2\/retention-onboarding\/status$/ },
  { methods: READ, path: under("/v2/users") },
  { methods: POST, path: /^\/v2\/users\/query$/ },
  { methods: READ, path: under("/v3/users") },
  { methods: READ, path: /^\/v2\/onboarding\/context$/ },
  { methods: POST, path: /^\/v2\/demand-score\/query$/ },
  { methods: READ, path: under("/v2/charts") },
  { methods: POST, path: /^\/v2\/charts\/(?:data|filter-values|acquisition-cohort-report)$/ },
  { methods: READ, path: new RegExp(`^/v2/applications/${ID}/.+$`) },
  { methods: READ, path: under("/v2/paywalls") },
  { methods: WRITE, path: new RegExp(`^/v2/paywalls/(?!templates(?:/|$))${ID}(?:/.*)?$`) },
  {
    methods: READ,
    path: new RegExp(`^/v2/products/(?!(?:app-store-connect|google-play|store-products|store-product-prices)(?:/|$))${ID}(?:/delete-impact)?$`),
  },
  { methods: READ, path: new RegExp(`^/v2/entitlements/${ID}(?:/.*)?$`) },
  { methods: WRITE, path: new RegExp(`^/v2/entitlements/${ID}(?:/.*)?$`) },
  { methods: new Set(["GET", "HEAD", "DELETE"]), path: new RegExp(`^/v2/assets/(?!(?:discover|upload-url)$)${ID}$`) },
  { methods: POST, path: /^\/v2\/assets\/upload-url$/ },
];

const MOUNT = /^\/dash-api(?=\/v[23](?:\/|$))/;
const QUERY_START = /[?;#]/;
const ORIGIN = /^https?:\/\/.*?\//;

const routedPath = (target: string): string => {
  const withoutOrigin = target.charCodeAt(0) === 47 ? target : target.replace(ORIGIN, "/");
  return withoutOrigin.split(QUERY_START, 1)[0]!;
};

const normalizedPath = (target: string): string => {
  const path = routedPath(target).toLowerCase().replace(/\/{2,}/g, "/").replace(MOUNT, "");
  return path.length > 1 && path.endsWith("/") ? path.replace(/\/+$/, "") : path;
};

const pathSpellings = (target: string): readonly string[] => {
  const path = routedPath(target);
  const raw = normalizedPath(path);
  try {
    const decoded = normalizedPath(decodeURIComponent(path));
    return decoded === raw ? [raw] : [raw, decoded];
  } catch {
    return [raw];
  }
};

const isAllowedPath = (method: string, path: string, narrowed: boolean): boolean =>
  !DENIED.some((pattern) => pattern.test(path)) &&
  ALLOWED.some((rule) => rule.methods.has(method) && rule.path.test(path)) &&
  (!narrowed || NARROWED.some((rule) => rule.methods.has(method) && rule.path.test(path)));

export const isArtifactRequestAllowed = (method: string, target: string, narrowed: boolean): boolean => {
  const normalized = method.toUpperCase();
  return pathSpellings(target).every((path) => isAllowedPath(normalized, path, narrowed));
};
