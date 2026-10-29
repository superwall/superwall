import { defineResource } from "@/core/main/define";

export const command = defineResource({
  name: "webhooks",
  summary: "Endpoints that receive your events",
  operations: [
    {
      name: "list",
      summary: "Webhook endpoints of a project",
      effect: "read",
      method: "GET",
      path: "/v2/projects/{project_id}/webhook_endpoints",
      list: true,
    },
    {
      name: "get",
      summary: "One endpoint",
      effect: "read",
      method: "GET",
      path: "/v2/projects/{project_id}/webhook_endpoints/{endpoint_id}",
    },
    {
      name: "create",
      summary: "Add an endpoint",
      effect: "write",
      details: "Delivers subscribed events to the HTTPS URL you specify.",
      method: "POST",
      path: "/v2/projects/{project_id}/webhook_endpoints",
    },
    {
      name: "update",
      summary: "Change an endpoint",
      effect: "destructive",
      details: `Changes where or which subscribed events are delivered; the destination can be any HTTPS URL you specify.

Overwrites destination, filters, headers and disabled state; can stop or redirect existing event delivery.`,
      method: "PATCH",
      path: "/v2/projects/{project_id}/webhook_endpoints/{endpoint_id}",
    },
    {
      name: "delete",
      summary: "Remove an endpoint",
      effect: "destructive",
      method: "DELETE",
      path: "/v2/projects/{project_id}/webhook_endpoints/{endpoint_id}",
      destructive: true,
    },
    {
      name: "rotate-secret",
      summary: "Issue a new signing secret",
      effect: "destructive",
      method: "POST",
      path: "/v2/projects/{project_id}/webhook_endpoints/{endpoint_id}/rotate_secret",
      destructive: true,
    },
    {
      name: "attempts",
      summary: "Its delivery attempts",
      effect: "read",
      method: "GET",
      path: "/v2/projects/{project_id}/webhook_endpoints/{endpoint_id}/attempts",
      list: true,
    },
    {
      name: "stats",
      summary: "Its delivery statistics",
      effect: "read",
      method: "GET",
      path: "/v2/projects/{project_id}/webhook_endpoints/{endpoint_id}/stats",
    },
  ],
  examples: [
    ["webhooks list --app <app>", "Webhook endpoints of an app's project"],
    ["webhooks attempts <endpoint> --app <app>", "How deliveries to one endpoint went"],
  ],
});
