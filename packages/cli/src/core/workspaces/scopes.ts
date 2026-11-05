const READ_FAMILIES: readonly (readonly [RegExp, string])[] = [
  [/^\/v2\/organizations\/[^/]+\/query$/, "data:read"],
  [/^\/v2\/projects\/[^/]+\/custom-stores(\/|$)/, "custom_stores:read"],
  [/^\/v2\/projects(\/|$)/, "projects:read"],
  [/^\/v2\/applications(\/|$)/, "applications:read"],
  [/^\/v2\/paywalls(\/|$)/, "paywalls:read"],
  [/^\/v2\/campaigns(\/|$)/, "campaigns:read"],
  [/^\/v2\/products(\/|$)/, "products:read"],
  [/^\/v2\/entitlements(\/|$)/, "entitlements:read"],
  [/^\/v2\/assets(\/|$)/, "assets:read"],
  [/^\/v2\/surveys(\/|$)/, "surveys:read"],
  [/^\/v2\/retention-(campaigns|configurations|default-messages|messages)(\/|$)/, "retention_messages:read"],
  [/^\/v2\/(charts|demand-score)(\/|$)/, "charts:read"],
  [/^\/v[23]\/users(\/|$)/, "users:read"],
  [/^\/v2\/onboarding(\/|$)/, "onboarding:read"],
];

const READ_POSTS = /^\/v2\/(organizations\/[^/]+\/query|charts\/(data|filter-values|acquisition-cohort-report)|users\/query|demand-score\/query)$/;

export function scopeForRoute(method: string, pathname: string): string | undefined {
  if (method !== "GET" && method !== "HEAD" && !(method === "POST" && READ_POSTS.test(pathname))) return undefined;
  return READ_FAMILIES.find(([route]) => route.test(pathname))?.[1];
}
