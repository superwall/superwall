import { describe, expect, it } from "vitest";
import {
  createSuperwallProduct,
  mergeIncomingProducts,
  mergeProductVariables,
  productVariablesFromTemplateVariables,
  productsByReference,
} from "../../src/products";

describe("productVariablesFromTemplateVariables", () => {
  it("reads the products array form", () => {
    const map = productVariablesFromTemplateVariables({
      products: [{ primary: { price: "$1" } }, { secondary: { price: "$2" } }, "junk", { x: 1 }],
    });
    expect(map.get("primary")).toEqual({ price: "$1" });
    expect(map.get("secondary")).toEqual({ price: "$2" });
    expect(map.has("x")).toBe(false);
  });

  it("reads the iOS template's top-level primary/secondary/tertiary without overriding", () => {
    const map = productVariablesFromTemplateVariables({
      primary: { price: "$legacy" },
      products: [{ primary: { price: "$modern" } }],
    });
    expect(map.get("primary")).toEqual({ price: "$modern" });

    const legacyOnly = productVariablesFromTemplateVariables({ tertiary: { price: "$3" } });
    expect(legacyOnly.get("tertiary")).toEqual({ price: "$3" });
    expect(productVariablesFromTemplateVariables({ products: "nope" }).size).toBe(0);
  });
});

describe("mergeIncomingProducts", () => {
  it("upgrades existing products to SDK source while keeping their variables", () => {
    const current = [
      createSuperwallProduct({
        reference: "primary",
        productId: "old",
        variables: { price: "$1" },
        source: "inline",
      }),
    ];

    const merged = mergeIncomingProducts(current, [{ product: "primary", productId: "new" }]);
    expect(merged).toEqual([
      { reference: "primary", productId: "new", source: "sdk", variables: { price: "$1" } },
    ]);
  });

  it("adds products the config did not declare", () => {
    const merged = mergeIncomingProducts([], [{ product: "surprise", productId: "x" }]);
    expect(merged[0]).toEqual({
      reference: "surprise",
      productId: "x",
      source: "sdk",
      variables: {},
    });
  });
});

describe("mergeProductVariables", () => {
  it("applies variables to existing products and creates missing references", () => {
    const current = [
      createSuperwallProduct({ reference: "primary", productId: "p", source: "sdk" }),
    ];
    const merged = mergeProductVariables(
      current,
      new Map([
        ["primary", { price: "$1" }],
        ["secondary", { price: "$2" }],
      ]),
    );

    expect(productsByReference(merged).primary).toEqual({
      reference: "primary",
      productId: "p",
      source: "sdk",
      variables: { price: "$1" },
    });
    expect(productsByReference(merged).secondary).toEqual({
      reference: "secondary",
      source: "sdk",
      variables: { price: "$2" },
    });
  });
});
