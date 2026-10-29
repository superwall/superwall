import { defineResource } from "@/core/main/define";

export const command = defineResource({
  name: "users",
  summary: "Your app's users: subscriptions, entitlements, attributes",
  operations: [
    {
      name: "get",
      summary: "Find a user by app user ID",
      effect: "read",
      method: "GET",
      path: "/v2/users/resolve",
      args: ["app_user_id"],
    },
    {
      name: "subscriptions",
      summary: "Every subscription they have had, one row each",
      effect: "read",
      method: "GET",
      path: "/v3/users/{app_user_id}/subscriptions",
      details: "The full history. For a one-glance answer (are they paying, status, lifetime value), use summary.",
    },
    {
      name: "summary",
      summary: "One answer: are they paying, their status, spend, MRR and lifetime value",
      effect: "read",
      method: "GET",
      path: "/v2/users/{app_user_id}/subscription-summary",
      details: "For every subscription they have had, use subscriptions.",
    },
    {
      name: "entitlements",
      summary: "What they have access to now",
      effect: "read",
      method: "GET",
      path: "/v2/users/{app_user_id}/active-entitlements",
    },
    {
      name: "attributes",
      summary: "Attributes the SDK set on them",
      effect: "read",
      method: "GET",
      path: "/v3/users/{app_user_id}/attributes",
    },
    {
      name: "update",
      summary: "Set attributes on them",
      details: "Queues attribute updates that replace stored user attribute values and can change audience matching.",
      effect: "destructive",
      method: "POST",
      path: "/v3/users/{app_user_id}/attributes",
    },
    { name: "aliases", summary: "Their other IDs", effect: "read", method: "GET", path: "/v3/users/{app_user_id}/aliases" },
    {
      name: "events",
      summary: "What they did, newest first",
      effect: "read",
      method: "GET",
      path: "/v2/users/{app_user_id}/events",
      list: true,
    },
  ],
  examples: [["users subscriptions <user> --app <app>", "A user's subscriptions"]],
});
