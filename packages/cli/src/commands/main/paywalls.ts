import { LIST_FLAGS } from "@/core/main/catalog";
import { defineResource } from "@/core/main/define";

export const command = defineResource({
  name: "paywalls",
  summary: "Paywalls in the dashboard",
  operations: [
    { name: "list", summary: "Paywalls of an app", handler: "resource", flags: LIST_FLAGS },
    { name: "get", summary: "One paywall", method: "GET", path: "/v2/paywalls/{id}" },
    { name: "create", summary: "Create a paywall", method: "POST", path: "/v2/paywalls" },
    { name: "duplicate", summary: "Copy a paywall", method: "POST", path: "/v2/paywalls/{id}/duplicate" },
    { name: "publish", summary: "Publish its draft", method: "POST", path: "/v2/paywalls/{id}/publish" },
    {
      name: "archive",
      summary: "Archive it",
      method: "POST",
      path: "/v2/paywalls/{id}/archive",
      destructive: true,
    },
    { name: "unarchive", summary: "Bring it back", method: "POST", path: "/v2/paywalls/{id}/unarchive" },
    {
      name: "versions",
      summary: "Versions pushed from code",
      method: "GET",
      path: "/v2/paywalls/{id}/versions",
      list: true,
    },
  ],
  examples: [
    ["paywalls list --app <app>", "Paywalls of one app"],
    ["paywalls get <paywall>", "One paywall in full"],
  ],
});
