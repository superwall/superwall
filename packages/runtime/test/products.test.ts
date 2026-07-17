import { describe, expect, it } from "vitest";
import {
  createSuperwallProduct,
  mergeIncomingProducts,
  mergeProductVariables,
  productReferenceFromInput,
  productVariablesFromTemplateVariables,
  productsByReference,
  productsFromIncomingMessage,
} from "../src/products";

describe("createSuperwallProduct", () => {
  it("creates a product from a reference string", () => {
    expect(createSuperwallProduct("primary")).toEqual({
      reference: "primary",
      product: "primary",
      variables: {},
      source: "unknown",
    });
  });

  it("derives ids from any provided identifier field", () => {
    expect(
      createSuperwallProduct({ reference: "primary", productIdentifier: "pro" }),
    ).toMatchObject({ id: "pro", productId: "pro", productIdentifier: "pro" });
    expect(createSuperwallProduct({ reference: "primary", id: "pro" })).toMatchObject({
      productId: "pro",
      productIdentifier: "pro",
    });
  });

  it("keeps provided variables and source", () => {
    expect(
      createSuperwallProduct({ reference: "p", variables: { price: "$1" }, source: "sdk" }),
    ).toMatchObject({ variables: { price: "$1" }, source: "sdk" });
  });
});

describe("productReferenceFromInput", () => {
  it("accepts strings and objects", () => {
    expect(productReferenceFromInput("primary")).toBe("primary");
    expect(productReferenceFromInput({ reference: "secondary" })).toBe("secondary");
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
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      productId: "new",
      source: "sdk",
      variables: { price: "$1" },
    });
  });

  it("adds products the config did not declare", () => {
    const merged = mergeIncomingProducts([], [{ product: "surprise", productId: "x" }]);
    expect(merged[0]).toMatchObject({ reference: "surprise", source: "sdk", variables: {} });
  });
});

describe("productVariablesFromTemplateVariables", () => {
  it("reads the products array form", () => {
    const map = productVariablesFromTemplateVariables({
      products: [{ primary: { price: "$1" } }, { secondary: { price: "$2" } }],
    });
    expect(map.get("primary")).toEqual({ price: "$1" });
    expect(map.get("secondary")).toEqual({ price: "$2" });
  });

  it("reads legacy top-level primary/secondary/tertiary keys without overriding", () => {
    const map = productVariablesFromTemplateVariables({
      primary: { price: "$legacy" },
      products: [{ primary: { price: "$modern" } }],
    });
    expect(map.get("primary")).toEqual({ price: "$modern" });

    const legacyOnly = productVariablesFromTemplateVariables({ tertiary: { price: "$3" } });
    expect(legacyOnly.get("tertiary")).toEqual({ price: "$3" });
  });
});

describe("productsFromIncomingMessage", () => {
  it("maps a products message to SDK-sourced products", () => {
    const products = productsFromIncomingMessage({
      event_name: "products",
      products: [{ product: "primary", productId: "pro" }],
    });

    expect(products).toEqual([
      expect.objectContaining({ reference: "primary", productId: "pro", source: "sdk" }),
    ]);
  });
});

describe("mergeProductVariables", () => {
  it("applies variables to existing products and creates missing references", () => {
    const current = [createSuperwallProduct({ reference: "primary", source: "sdk" })];
    const merged = mergeProductVariables(
      current,
      new Map([
        ["primary", { price: "$1" }],
        ["secondary", { price: "$2" }],
      ]),
    );

    expect(productsByReference(merged).primary?.variables).toEqual({ price: "$1" });
    expect(productsByReference(merged).secondary).toMatchObject({
      variables: { price: "$2" },
      source: "sdk",
    });
  });
});
