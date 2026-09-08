import { describe, expect, it } from "vitest";
import {
  createSuperwallProduct,
  findProductByStoreId,
  productReferenceFromInput,
  productsByReference,
} from "../../src/products";

describe("createSuperwallProduct", () => {
  it("creates a product from a reference string", () => {
    expect(createSuperwallProduct("primary")).toEqual({
      reference: "primary",
      variables: {},
      source: "unknown",
    });
  });

  it("keeps a provided id, variables and source, and adds no id key without one", () => {
    expect(
      createSuperwallProduct({
        reference: "p",
        productId: "pro",
        variables: { price: "$1" },
        source: "sdk",
      }),
    ).toEqual({ reference: "p", productId: "pro", variables: { price: "$1" }, source: "sdk" });
    expect(Object.keys(createSuperwallProduct({ reference: "p" }))).toEqual([
      "reference",
      "variables",
      "source",
    ]);
  });
});

describe("productReferenceFromInput", () => {
  it("accepts strings and objects", () => {
    expect(productReferenceFromInput("primary")).toBe("primary");
    expect(productReferenceFromInput({ reference: "secondary" })).toBe("secondary");
  });
});

describe("productsByReference", () => {
  it("indexes products by reference, last one winning", () => {
    const a = createSuperwallProduct({ reference: "a", productId: "1" });
    const b = createSuperwallProduct({ reference: "a", productId: "2" });
    expect(productsByReference([a, b])).toEqual({ a: b });
  });
});

describe("findProductByStoreId", () => {
  const products = [createSuperwallProduct({ reference: "primary", productId: "pro_year" })];

  it("finds by store identifier and never matches without one", () => {
    expect(findProductByStoreId(products, "pro_year")?.reference).toBe("primary");
    expect(findProductByStoreId(products, "other")).toBeUndefined();
    expect(findProductByStoreId(products, undefined)).toBeUndefined();
  });
});
