import { LIST_FLAGS } from "@/core/main/catalog";
import { defineResource } from "@/core/main/define";

export const command = defineResource({
  name: "products",
  summary: "Products and their store prices",
  operations: [
    { name: "list", summary: "Products of a project", effect: "read", handler: "resource", flags: LIST_FLAGS },
    { name: "get", summary: "One product", effect: "read", method: "GET", path: "/v2/products/{id}" },
    {
      name: "create",
      summary: "Create a product",
      effect: "write",
      handler: "resource",
      usage: "--identifier <identifier>",
      flags: [
        ["--identifier <id>", "The store product ID"],
        ["--name <name>", "Display name"],
        [
          "--store <store>",
          "app_store | play_store | custom; custom without --app uses the project's default custom store",
        ],
        ["--price <amount>", "Price in the currency's main unit, e.g. 9.99 (sent to the API as 999 cents)"],
        ["--currency <code>", "ISO currency, default USD"],
        ["--period <p>", "day | week | month | year"],
        ["--period-count <n>", "Periods per cycle, default 1"],
        ["--trial-days <n>", "Free-trial length in days"],
        ["--entitlement <id>", "Entitlement to grant, by id or identifier (repeatable); it must be on the product's app"],
      ],
    },
    { name: "update", summary: "Change a product", effect: "destructive", method: "PATCH", path: "/v2/products/{id}", destructive: true },
    {
      name: "delete",
      summary: "Delete a product",
      effect: "destructive",
      method: "DELETE",
      path: "/v2/products/{id}",
      destructive: true,
    },
    {
      name: "impact",
      summary: "What deleting it would break",
      effect: "read",
      method: "GET",
      path: "/v2/products/{id}/delete-impact",
    },
    {
      name: "storekit",
      summary: "Write a StoreKit configuration file for Xcode",
      effect: "write",
      handler: "resource",
      flags: [["--out <file>", "Where to write it"]],
      mcp: false,
    },
  ],
  examples: [
    ["products list --app <app>", "Products of an app's project"],
    ["products create --identifier <id> --price 9.99 --period month", "A monthly subscription"],
    ["products create --identifier <id> --price 9.99 --period month --entitlement pro", "One that grants pro"],
    ["products create --identifier <id> --app <custom store> --price 9.99 --period month", "One in a custom store"],
  ],
});
