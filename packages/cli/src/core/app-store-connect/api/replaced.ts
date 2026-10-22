interface Replacement {
  path: string;
  methods?: readonly string[];
  query?: string;
  use: string;
  since: string;
}

const REVIEW_SUBMISSIONS = "/v1/reviewSubmissions with /v1/reviewSubmissionItems";
const ASSET_LIBRARY_IMAGES = "/v1/appAssetLibraryImages with /v1/appAssetLibraryPlacements";
const ASSET_LIBRARY_VIDEOS = "/v1/appAssetLibraryVideos with /v1/appAssetLibraryPlacements";

export const REPLACED: readonly Replacement[] = [
  { path: "/v1/subscriptionLocalizations", use: "/v2/subscriptionLocalizations, on a subscription version", since: "4.4.1" },
  { path: "/v1/subscriptions/{id}/subscriptionLocalizations", use: "/v1/subscriptionVersions/{id}/localizations", since: "4.4.1" },
  { path: "/v1/subscriptionGroupLocalizations", use: "/v2/subscriptionGroupLocalizations, on a group version", since: "4.4.1" },
  { path: "/v1/subscriptionGroups/{id}/subscriptionGroupLocalizations", use: "/v1/subscriptionGroupVersions/{id}/localizations", since: "4.4.1" },
  { path: "/v1/inAppPurchaseLocalizations", use: "/v2/inAppPurchaseLocalizations, on an in-app purchase version", since: "4.4.1" },
  { path: "/v2/inAppPurchases/{id}/inAppPurchaseLocalizations", use: "/v1/inAppPurchaseVersions/{id}/localizations", since: "4.4.1" },
  { path: "/v1/subscriptionImages", use: "/v2/subscriptionImages", since: "4.4.1" },
  { path: "/v1/subscriptions/{id}/images", use: "/v1/subscriptionVersions/{id}/images", since: "4.4.1" },
  { path: "/v1/inAppPurchaseImages", use: "/v2/inAppPurchaseImages", since: "4.4.1" },
  { path: "/v2/inAppPurchases/{id}/images", use: "/v1/inAppPurchaseVersions/{id}/images", since: "4.4.1" },
  { path: "/v1/subscriptionSubmissions", use: REVIEW_SUBMISSIONS, since: "4.4.1" },
  { path: "/v1/subscriptionGroupSubmissions", use: REVIEW_SUBMISSIONS, since: "4.4.1" },
  { path: "/v1/inAppPurchaseSubmissions", use: REVIEW_SUBMISSIONS, since: "4.4.1" },
  { path: "/v1/subscriptionAvailabilities", use: "/v1/subscriptionPlanAvailabilities", since: "4.4" },
  { path: "/v1/subscriptions/{id}/subscriptionAvailability", use: "/v1/subscriptions/{id}/planAvailabilities", since: "4.4" },
  { path: "/v1/inAppPurchases", use: "/v2/inAppPurchases", since: "3.0" },
  { path: "/v1/apps/{id}/inAppPurchases", use: "/v1/apps/{id}/inAppPurchasesV2", since: "2.0" },
  { path: "/v1/appStoreVersionSubmissions", use: REVIEW_SUBMISSIONS, since: "1.7" },
  { path: "/v1/appStoreVersions/{id}/appStoreVersionSubmission", use: "/v1/reviewSubmissions?filter[app]=…", since: "1.7" },
  { path: "/v1/appStoreVersionExperiments", use: "/v2/appStoreVersionExperiments", since: "2.4" },
  { path: "/v1/appStoreVersions/{id}/appStoreVersionExperiments", use: "/v1/appStoreVersions/{id}/appStoreVersionExperimentsV2", since: "2.4" },
  { path: "/v1/apps/{id}/appStoreVersions", query: "filter[appStoreState]", use: "filter[appVersionState] (the appStoreState attribute is replaced by appVersionState)", since: "3.7" },
  { path: "/v1/appScreenshotSets", use: ASSET_LIBRARY_IMAGES, since: "4.5" },
  { path: "/v1/appScreenshots", use: ASSET_LIBRARY_IMAGES, since: "4.5" },
  { path: "/v1/appPreviewSets", use: ASSET_LIBRARY_VIDEOS, since: "4.5" },
  { path: "/v1/appPreviews", use: ASSET_LIBRARY_VIDEOS, since: "4.5" },
  { path: "/v1/appStoreVersionLocalizations/{id}/appScreenshotSets", use: "/v1/appStoreVersionLocalizations/{id}/placements", since: "4.5" },
  { path: "/v1/appStoreVersionLocalizations/{id}/appPreviewSets", use: "/v1/appStoreVersionLocalizations/{id}/placements", since: "4.5" },
  { path: "/v1/builds/{id}/relationships/appEncryptionDeclaration", methods: ["PATCH"], use: "PATCH /v1/builds/{id} with the appEncryptionDeclaration relationship", since: "4.0" },
];

function segmentsOf(path: string): string[] {
  const [bare = ""] = path.split("?");
  return bare.split("/").filter(Boolean);
}

function matches(rule: Replacement, method: string, path: string): boolean {
  if (rule.methods && !rule.methods.includes(method.toUpperCase())) return false;
  const query = (path.split("?")[1] ?? "").replace(/%5B/gi, "[").replace(/%5D/gi, "]");
  if (rule.query && !query.includes(rule.query)) return false;
  const pattern = segmentsOf(rule.path);
  const keepsRelationships = pattern.includes("relationships");
  const concrete = segmentsOf(path).filter((segment, index) => keepsRelationships || !(segment === "relationships" && index === 3));
  if (concrete.length < pattern.length) return false;
  return pattern.every((segment, index) => segment === "{id}" || segment === concrete[index]);
}

export function selectReplacement(method: string, path: string): Replacement | undefined {
  return REPLACED.find((rule) => matches(rule, method, path));
}

export function formatReplacement(rule: Replacement): string {
  const what = rule.query ? `${rule.query} on ${rule.path}` : rule.path;
  return `Apple replaced ${what} in API ${rule.since}: use ${rule.use}.`;
}
