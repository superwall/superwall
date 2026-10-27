import { LIST_FLAGS } from "@/core/main/catalog";
import { defineResource } from "@/core/main/define";

export const command = defineResource({
  name: "entitlements",
  summary: "What a purchase unlocks",
  operations: [
    { name: "list", summary: "Entitlements of a project", handler: "resource", flags: LIST_FLAGS },
    { name: "get", summary: "One entitlement", method: "GET", path: "/v2/entitlements/{id}" },
    {
      name: "create",
      summary: "Create an entitlement",
      handler: "resource",
      usage: "--identifier <identifier>",
      flags: [["--identifier <id>", "What the SDK checks for, e.g. pro"]],
    },
    { name: "update", summary: "Change an entitlement", method: "PATCH", path: "/v2/entitlements/{id}" },
    {
      name: "delete",
      summary: "Delete an entitlement",
      method: "DELETE",
      path: "/v2/entitlements/{id}",
      destructive: true,
    },
  ],
  nested: [
    {
      name: "grants",
      summary: "Entitlements given to a user without a purchase",
      operations: [
        {
          name: "list",
          summary: "Grants of an entitlement",
          method: "GET",
          path: "/v2/entitlements/{id}/grants",
          list: true,
        },
        {
          name: "create",
          summary: "Grant an existing entitlement manually to a device, optionally linked to an app user ID",
          details: "Grants promotional access, optionally until an expiry time, without charging the user or creating a paid subscription. Returns an error when an active grant already exists.",
          method: "POST",
          path: "/v2/entitlements/{id}/grants",
        },
        {
          name: "delete",
          summary: "Take a grant back",
          method: "DELETE",
          path: "/v2/entitlements/{id}/grants/{grant_id}",
          destructive: true,
        },
      ],
    },
  ],
  examples: [
    ["entitlements list --app <app>", "Entitlements of an app's project"],
    ["entitlements create --identifier pro --app <app>", "What the SDK checks for"],
  ],
});
