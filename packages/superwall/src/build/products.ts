import {
  isPlatformProductIds,
  productIdFor,
  type SuperwallConfig,
  type SuperwallPlatform,
} from "@superwall/runtime";
import type { Plugin } from "vite";
import { isStripeProductIdentifier } from "../checkout/products";
import type { DiscoveredSurface } from "../discover";

export type ProductCatalogue = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export const inlineProductsOf = (
  products: Record<string, string>,
  catalogue: ProductCatalogue | undefined,
): Record<string, Readonly<Record<string, unknown>>> => {
  const inline: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const [reference, identifier] of Object.entries(products)) {
    const variables = catalogue?.[identifier];
    if (variables?.price !== undefined && isStripeProductIdentifier(identifier)) {
      inline[reference] = variables;
    }
  }
  return inline;
};

export const resolveProductIds = (
  config: SuperwallConfig,
  surface: DiscoveredSurface,
  platform: SuperwallPlatform | undefined,
): Record<string, string> => {
  const missing: string[] = [];
  const resolved = Object.entries(config.products ?? {}).map(([reference, input]) => {
    const id = productIdFor(input, platform);
    if (id === undefined && platform !== undefined && isPlatformProductIds(input)) {
      missing.push(reference);
    }
    return [reference, id ?? reference] as const;
  });
  if (missing.length > 0) {
    throw new Error(
      `${surface.kind}s/${surface.id}: ${missing.map((reference) => `\`${reference}\``).join(", ")} ` +
        `${missing.length === 1 ? "has" : "have"} no product id for ${platform} — add one in config.ts, ` +
        `or drop ${platform} from this ${surface.kind}'s platforms.`,
    );
  }
  return Object.fromEntries(resolved);
};

const hasRange = (node: object): node is { start: number; end: number } =>
  "start" in node &&
  typeof node.start === "number" &&
  "end" in node &&
  typeof node.end === "number";

const propertyName = (key: unknown): unknown => {
  if (typeof key !== "object" || key === null || !("type" in key)) return undefined;
  if (key.type === "Identifier" && "name" in key) return key.name;
  if (key.type === "Literal" && "value" in key) return key.value;
  return undefined;
};

const exportedObject = (statement: object): object | undefined => {
  if (!("declaration" in statement)) return undefined;
  let object: unknown = statement.declaration;
  if (
    typeof object === "object" &&
    object !== null &&
    "type" in object &&
    object.type === "CallExpression" &&
    "arguments" in object &&
    Array.isArray(object.arguments)
  ) {
    object = object.arguments[0];
  }
  return typeof object === "object" &&
    object !== null &&
    "type" in object &&
    object.type === "ObjectExpression"
    ? object
    : undefined;
};

export const rewriteConfigProducts = (
  code: string,
  program: { body: readonly { type: string }[] },
  products: Record<string, string>,
): string | undefined => {
  const statement = program.body.find((node) => node.type === "ExportDefaultDeclaration");
  if (!statement) return undefined;
  const object = exportedObject(statement);
  if (!object || !("properties" in object) || !Array.isArray(object.properties)) {
    return undefined;
  }
  for (const property of object.properties) {
    if (typeof property !== "object" || property === null) continue;
    if (!("type" in property) || property.type !== "Property" || !("key" in property)) continue;
    if (propertyName(property.key) !== "products" || !("value" in property)) continue;
    const value: unknown = property.value;
    if (typeof value !== "object" || value === null || !hasRange(value)) return undefined;
    return `${code.slice(0, value.start)}${JSON.stringify(products)}${code.slice(value.end)}`;
  }
  return undefined;
};

export const resolveConfigProducts = (
  configFile: string,
  products: Record<string, string>,
): Plugin => ({
  name: "superwall:config-products",
  enforce: "post",
  transform(code, id) {
    if (id.split("?")[0] !== configFile) return null;
    const rewritten = rewriteConfigProducts(code, this.parse(code), products);
    return rewritten === undefined ? null : { code: rewritten, map: null };
  },
});
