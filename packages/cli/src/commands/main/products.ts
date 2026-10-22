import { LIST_FLAGS } from "@/core/main/catalog";
import { defineResource } from "@/core/main/define";

export const command = defineResource({
  name: "products",
  summary: "Products and their store prices",
  operations: [
    { name: "list", summary: "Products of a project", handler: "resource", flags: LIST_FLAGS },
    { name: "get", summary: "One product", method: "GET", path: "/v2/products/{id}" },
    {
      name: "create",
      summary: "Create a product",
      handler: "resource",
      usage: "--identifier <identifier>",
      flags: [
        ["--identifier <id>", "The store product ID"],
        ["--name <name>", "Display name"],
        ["--price <amount>", "Price in major units, e.g. 9.99"],
        ["--currency <code>", "ISO currency, default USD"],
        ["--period <p>", "day | week | month | year"],
        ["--period-count <n>", "Periods per cycle, default 1"],
        ["--trial-days <n>", "Free-trial length in days"],
        ["--entitlement <id>", "Entitlement to grant (repeatable)"],
      ],
    },
    { name: "update", summary: "Change a product", method: "PATCH", path: "/v2/products/{id}" },
    {
      name: "delete",
      summary: "Delete a product",
      method: "DELETE",
      path: "/v2/products/{id}",
      destructive: true,
    },
    {
      name: "impact",
      summary: "What deleting it would break",
      method: "GET",
      path: "/v2/products/{id}/delete-impact",
    },
    {
      name: "storekit",
      summary: "Write a StoreKit configuration file for Xcode",
      handler: "resource",
      flags: [["--out <file>", "Where to write it"]],
      mcp: false,
    },
  ],
  examples: [
    ["products list --app <app>", "Products of an app's project"],
    ["products create --identifier <id> --price 9.99 --period month", "A monthly subscription"],
  ],
});
