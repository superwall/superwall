import { defineResource } from "@/core/main/define";

export const command = defineResource({
  name: "events",
  summary: "Events sent to your webhooks",
  operations: [
    { name: "list", summary: "Recent events", effect: "read", method: "GET", path: "/v2/projects/{project_id}/events", list: true },
    {
      name: "get",
      summary: "One event",
      effect: "read",
      method: "GET",
      path: "/v2/projects/{project_id}/events/{event_id}",
    },
    {
      name: "attempts",
      summary: "Its delivery attempts",
      effect: "read",
      method: "GET",
      path: "/v2/projects/{project_id}/events/{event_id}/attempts",
      list: true,
    },
    {
      name: "retry",
      summary: "Deliver it again",
      details: "Resends an event to its configured webhook destination. Delivery cannot be recalled and may duplicate downstream processing.",
      effect: "destructive",
      method: "POST",
      path: "/v2/projects/{project_id}/events/{event_id}/retry",
    },
  ],
  examples: [
    ["events list --app <app>", "Recent events of an app's project"],
    ["events retry <event> --app <app>", "Deliver one event again"],
  ],
});
