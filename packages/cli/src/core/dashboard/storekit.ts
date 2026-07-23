import type { Row } from "@/core/api/resources";

// Xcode refines pricing/types on import; this only seeds the product identifiers.
export function generateStoreKit(products: Row[]): object {
  const items = products
    .map((p) => String(p.identifier ?? p.product_identifier ?? p.name ?? ""))
    .filter(Boolean);

  return {
    identifier: "SUPERWALL",
    nonRenewingSubscriptions: [],
    products: items.map((id, i) => ({
      displayPrice: "9.99",
      familyShareable: false,
      internalID: String(1000 + i),
      localizations: [{ description: id, displayName: id, locale: "en_US" }],
      productID: id,
      referenceName: id,
      type: "NonConsumable",
    })),
    settings: { _applicationInternalID: "SUPERWALL" },
    subscriptionGroups: [],
    version: { major: 3, minor: 0 },
  };
}
