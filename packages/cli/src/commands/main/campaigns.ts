import { LIST_FLAGS } from "@/core/main/catalog";
import { defineResource } from "@/core/main/define";

export const command = defineResource({
  name: "campaigns",
  summary: "Who sees which paywall, and when",
  operations: [
    { name: "list", summary: "Campaigns of an app", handler: "resource", flags: LIST_FLAGS },
    {
      name: "get",
      summary: "One campaign with its audiences and placements",
      method: "GET",
      path: "/v2/campaigns/{id}",
    },
    {
      name: "create",
      summary: "Create a campaign that a placement triggers",
      handler: "resource",
      usage: "--description <text> --placement <placement>",
      flags: [
        ["--description <text>", "What the campaign is for"],
        ["--placement <name>", "The event that triggers it"],
      ],
    },
    { name: "update", summary: "Change a campaign", method: "PATCH", path: "/v2/campaigns/{id}" },
    {
      name: "archive",
      summary: "Archive it",
      method: "POST",
      path: "/v2/campaigns/{id}/archive",
      destructive: true,
    },
    { name: "unarchive", summary: "Bring it back", method: "POST", path: "/v2/campaigns/{id}/unarchive" },
    { name: "prioritize", summary: "Put it first", method: "POST", path: "/v2/campaigns/{id}/prioritize" },
    {
      name: "counts",
      summary: "How many users each audience assigned",
      method: "GET",
      path: "/v2/campaigns/{id}/assignment-counts",
      details: "Exactly what the dashboard shows. For anything else about revenue, users or events, run SQL with `query`.",
    },
  ],
  nested: [
    {
      name: "placements",
      summary: "The events that trigger a campaign",
      operations: [
        {
          name: "create",
          summary: "Trigger it on an event",
          method: "POST",
          path: "/v2/campaigns/{id}/placements",
          destructive: true,
        },
        {
          name: "update",
          summary: "Change a placement",
          method: "PATCH",
          path: "/v2/campaigns/{id}/placements/{placement_id}",
        },
        {
          name: "delete",
          summary: "Stop triggering it on an event",
          method: "DELETE",
          path: "/v2/campaigns/{id}/placements/{placement_id}",
          destructive: true,
        },
      ],
    },
    {
      name: "audiences",
      summary: "Who a campaign targets, in order",
      operations: [
        { name: "create", summary: "Add an audience", method: "POST", path: "/v2/campaigns/{id}/audiences" },
        {
          name: "update",
          summary: "Change its rules or name",
          method: "PATCH",
          path: "/v2/campaigns/{id}/audiences/{audience_id}",
          destructive: true,
        },
        {
          name: "delete",
          summary: "Remove an audience",
          method: "DELETE",
          path: "/v2/campaigns/{id}/audiences/{audience_id}",
          destructive: true,
        },
        {
          name: "duplicate",
          summary: "Copy an audience",
          method: "POST",
          path: "/v2/campaigns/{id}/audiences/{audience_id}/duplicate",
        },
        {
          name: "reorder",
          summary: "Set the order audiences are matched in",
          method: "PUT",
          path: "/v2/campaigns/{id}/audiences/order",
        },
        {
          name: "reset",
          summary: "Forget who was assigned to it",
          method: "POST",
          path: "/v2/campaigns/{id}/audiences/{audience_id}/reset",
          destructive: true,
        },
        {
          name: "readout",
          summary: "How its variants are doing: conversion and revenue per variant",
          method: "GET",
          path: "/v2/campaigns/{id}/audiences/{audience_id}/readout",
          details: "Exactly what the dashboard shows. For anything else about revenue, users or events, run SQL with `query`.",
        },
        {
          name: "users",
          summary: "Users it matched",
          method: "GET",
          path: "/v2/campaigns/{id}/audiences/{audience_id}/users",
          list: true,
        },
        {
          name: "purchasers",
          summary: "Users who bought after seeing it",
          method: "GET",
          path: "/v2/campaigns/{id}/audiences/{audience_id}/purchasers",
          details: "Exactly what the dashboard shows. For anything else about revenue, users or events, run SQL with `query`.",
          list: true,
        },
      ],
    },
    {
      name: "variants",
      summary: "The paywalls an audience splits its traffic between",
      operations: [
        {
          name: "create",
          summary: "Add a variant",
          method: "POST",
          path: "/v2/campaigns/{id}/audiences/{audience_id}/variants",
        },
        {
          name: "update",
          summary: "Change its paywall",
          method: "PATCH",
          path: "/v2/campaigns/{id}/audiences/{audience_id}/variants/{variant_id}",
          destructive: true,
        },
        {
          name: "delete",
          summary: "Remove a variant",
          method: "DELETE",
          path: "/v2/campaigns/{id}/audiences/{audience_id}/variants/{variant_id}",
          destructive: true,
        },
        {
          name: "weights",
          summary: "Set each variant's share of traffic",
          method: "PUT",
          path: "/v2/campaigns/{id}/audiences/{audience_id}/weights",
        },
      ],
    },
  ],
  examples: [
    ["campaigns list --app <app>", "Campaigns of one app"],
    ["campaigns get <campaign>", "One campaign in full"],
    ["campaigns placements create <campaign> --event-name <placement>", "Trigger it on a placement"],
    ["campaigns audiences readout <campaign> <audience>", "How an audience is doing"],
  ],
});
