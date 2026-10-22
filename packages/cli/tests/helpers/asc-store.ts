import { link, one, page } from "./asc-proxy";

export const APP_BY_BUNDLE = "GET /v1/apps?filter[bundleId]=com.acme.app&fields[apps]=bundleId&limit=10";
export const GROUPS_OF_APP = "GET /v1/apps/555/subscriptionGroups?limit=200";
export const USA_POINTS = (id: string) =>
  `GET /v1/subscriptions/${id}/pricePoints?filter[territory]=USA&limit=200&fields[subscriptionPricePoints]=customerPrice,proceeds`;
export const EQUALIZATIONS = (point: string) =>
  `GET /v1/subscriptionPricePoints/${point}/equalizations?include=territory&limit=200&fields[subscriptionPricePoints]=customerPrice,territory`;

export function subscriptionView(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [`GET /v1/subscriptions/${id}?include=group`]: {
      data: one(
        "subscriptions",
        id,
        { productId: "pro.monthly", name: "Pro Monthly", state: "MISSING_METADATA", subscriptionPeriod: "ONE_MONTH", familySharable: false, groupLevel: 1 },
        { group: link("subscriptionGroups", "G1") },
      ),
      included: [one("subscriptionGroups", "G1", { referenceName: "Pro" })],
    },
    [`GET /v1/subscriptions/${id}/versions`]: page([one("subscriptionVersions", "V1", { version: 1, state: "PREPARE_FOR_SUBMISSION" })]),
    "GET /v1/subscriptionVersions/V1/localizations?limit=200": page([one("subscriptionLocalizations", "L1", { locale: "en-US", name: "Pro" })]),
    [`GET /v1/subscriptions/${id}/prices?include=subscriptionPricePoint,territory&limit=200&fields[subscriptionPricePoints]=customerPrice,proceeds`]: page(
      [
        one("subscriptionPrices", "PR1", { startDate: null, planType: "UPFRONT" }, {
          territory: link("territories", "USA"),
          subscriptionPricePoint: link("subscriptionPricePoints", "P-USA"),
        }),
      ],
      { included: [one("subscriptionPricePoints", "P-USA", { customerPrice: "9.99", proceeds: "8.49" })] },
    ),
    [`GET /v1/subscriptions/${id}/introductoryOffers?include=territory,subscriptionPricePoint&limit=200&fields[subscriptionPricePoints]=customerPrice`]: page([
      one("subscriptionIntroductoryOffers", "O1", { offerMode: "FREE_TRIAL", duration: "ONE_WEEK", numberOfPeriods: 1 }, { territory: link("territories", "USA") }),
    ]),
    [`GET /v1/subscriptions/${id}/planAvailabilities?limit=50`]: page([
      one("subscriptionPlanAvailabilities", "A1", { planType: "UPFRONT", availableInNewTerritories: false }),
    ]),
    "GET /v1/subscriptionPlanAvailabilities/A1/availableTerritories?limit=200": page([one("territories", "USA"), one("territories", "CAN")]),
    [`GET /v1/subscriptions/${id}/appStoreReviewScreenshot`]: { data: null },
    ...extra,
  };
}

export function iapView(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [`GET /v2/inAppPurchases/${id}`]: {
      data: one("inAppPurchases", id, { productId: "coins.100", name: "Coins", inAppPurchaseType: "CONSUMABLE", state: "MISSING_METADATA", familySharable: false, reviewNote: "Tap buy" }),
    },
    [`GET /v2/inAppPurchases/${id}/versions`]: page([one("inAppPurchaseVersions", "IV1", { version: 1, state: "PREPARE_FOR_SUBMISSION" })]),
    "GET /v1/inAppPurchaseVersions/IV1/localizations?limit=200": page([]),
    [`GET /v2/inAppPurchases/${id}/iapPriceSchedule?include=baseTerritory`]: {
      data: one("inAppPurchasePriceSchedules", "SCH", {}, { baseTerritory: link("territories", "USA") }),
    },
    "GET /v1/inAppPurchasePriceSchedules/SCH/manualPrices?include=inAppPurchasePricePoint,territory&limit=200&fields[inAppPurchasePricePoints]=customerPrice,proceeds": page(
      [
        one("inAppPurchasePrices", "MP1", { startDate: "2026-01-01", manual: true }, {
          territory: link("territories", "USA"),
          inAppPurchasePricePoint: link("inAppPurchasePricePoints", "IP-USA"),
        }),
      ],
      { included: [one("inAppPurchasePricePoints", "IP-USA", { customerPrice: "0.99", proceeds: "0.84" })] },
    ),
    "GET /v1/inAppPurchasePriceSchedules/SCH/automaticPrices?include=inAppPurchasePricePoint,territory&limit=200&fields[inAppPurchasePricePoints]=customerPrice,proceeds": page([
      one("inAppPurchasePrices", "AP1", { manual: false }, { territory: link("territories", "CAN") }),
    ]),
    [`GET /v2/inAppPurchases/${id}/inAppPurchaseAvailability`]: { data: one("inAppPurchaseAvailabilities", "IA1", { availableInNewTerritories: true }) },
    "GET /v1/inAppPurchaseAvailabilities/IA1/availableTerritories?limit=200": page([one("territories", "USA")]),
    [`GET /v2/inAppPurchases/${id}/appStoreReviewScreenshot`]: {
      data: one("inAppPurchaseAppStoreReviewScreenshots", "SS1", { fileName: "coins.png", assetDeliveryState: { state: "COMPLETE" } }),
    },
    ...extra,
  };
}

export const VERSION_ID = "1b73ab0b-9e84-4cf6-ba02-f74e22ca5d54";
export const BUILD_ID = "60869ed6-6cd2-466d-9e59-9b5ab926a539";
export const VERSION_FIELDS = "platform,versionString,appVersionState,releaseType,earliestReleaseDate,copyright,createdDate";
export const VERSION_BY_STRING = (version = "1.2.0", platform = "IOS") =>
  `GET /v1/apps/555/appStoreVersions?filter[versionString]=${version}&filter[platform]=${platform}&fields[appStoreVersions]=versionString&limit=1`;
export const VERSION_READ = (include: string[] = [], id = VERSION_ID) =>
  `GET /v1/appStoreVersions/${id}?fields[appStoreVersions]=${[VERSION_FIELDS, ...include].join(",")}${include.length ? `&include=${include.join(",")}` : ""}`;

export function appVersion(attributes: Record<string, unknown> = {}, relationships: Record<string, unknown> = {}, id = VERSION_ID) {
  return one("appStoreVersions", id, { platform: "IOS", versionString: "1.2.0", appVersionState: "PREPARE_FOR_SUBMISSION", releaseType: "MANUAL", ...attributes }, relationships);
}
