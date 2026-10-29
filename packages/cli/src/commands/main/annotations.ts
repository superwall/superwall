import { defineResource } from "@/core/main/define";

export const command = defineResource({
  name: "annotations",
  summary: "Releases, campaigns and incidents marked on an app's charts",
  operations: [
    {
      name: "list",
      summary: "Annotations of an app",
      details: "With --from and --to, only those overlapping that window.",
      method: "GET",
      path: "/v2/applications/{application_id}/chart_annotations",
      list: true,
    },
    {
      name: "get",
      summary: "One annotation",
      method: "GET",
      path: "/v2/applications/{application_id}/chart_annotations/{chart_annotation_id}",
    },
    {
      name: "create",
      summary: "Mark a moment or a span on every chart of an app",
      method: "POST",
      path: "/v2/applications/{application_id}/chart_annotations",
    },
    {
      name: "update",
      summary: "Change an annotation",
      details:
        "Only what you pass changes. --end-at null turns a span into a point; --description null removes the description.",
      method: "PATCH",
      path: "/v2/applications/{application_id}/chart_annotations/{chart_annotation_id}",
    },
    {
      name: "delete",
      summary: "Delete an annotation",
      details: "Removes it from every chart of the app. This can't be undone.",
      method: "DELETE",
      path: "/v2/applications/{application_id}/chart_annotations/{chart_annotation_id}",
      destructive: true,
    },
  ],
  examples: [
    ["annotations list --app <app>", "Everything marked on an app's charts"],
    [
      'annotations create --app <app> --label "v4.2.0 released" --start-at 2026-10-28T14:00:00Z',
      "Mark today's release",
    ],
  ],
});
