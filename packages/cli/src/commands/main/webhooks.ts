import { defineResource } from "@/core/main/define";

export const command = defineResource({
  name: "webhooks",
  summary: "Endpoints that receive your events",
  operations: [
    {
      name: "list",
      summary: "Webhook endpoints of a project",
      method: "GET",
      path: "/v2/projects/{project_id}/webhook_endpoints",
      list: true,
    },
    {
      name: "get",
      summary: "One endpoint",
      method: "GET",
      path: "/v2/projects/{project_id}/webhook_endpoints/{endpoint_id}",
    },
    {
      name: "create",
      summary: "Add an endpoint",
      method: "POST",
      path: "/v2/projects/{project_id}/webhook_endpoints",
    },
    {
      name: "update",
      summary: "Change an endpoint",
      method: "PATCH",
      path: "/v2/projects/{project_id}/webhook_endpoints/{endpoint_id}",
    },
    {
      name: "delete",
      summary: "Remove an endpoint",
      method: "DELETE",
      path: "/v2/projects/{project_id}/webhook_endpoints/{endpoint_id}",
      destructive: true,
    },
    {
      name: "rotate-secret",
      summary: "Issue a new signing secret",
      method: "POST",
      path: "/v2/projects/{project_id}/webhook_endpoints/{endpoint_id}/rotate_secret",
      destructive: true,
    },
    {
      name: "attempts",
      summary: "Its delivery attempts",
      method: "GET",
      path: "/v2/projects/{project_id}/webhook_endpoints/{endpoint_id}/attempts",
      list: true,
    },
    {
      name: "stats",
      summary: "Its delivery statistics",
      method: "GET",
      path: "/v2/projects/{project_id}/webhook_endpoints/{endpoint_id}/stats",
    },
  ],
  examples: [
    ["webhooks list --app <app>", "Webhook endpoints of an app's project"],
    ["webhooks attempts <endpoint> --app <app>", "How deliveries to one endpoint went"],
  ],
});
