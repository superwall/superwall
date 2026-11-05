# Workspace starter

A workspace is a small Worker that adds to the Superwall dashboard: a page, a panel, or a metric in
Charts. It holds no credential and calls Superwall as whoever is viewing it.

    superwall workspaces dev                         # http://localhost:8787 against your real data, read-only
    superwall workspaces try transactions --app <id> # the metric on the real runtime
    superwall workspaces try home                    # the page in the dashboard

- `superwall.json` says what it does: its scopes and entrypoints.
- `src/worker.ts` is the code. `fetch` serves pages, `metric` answers `chart.source@1` entrypoints and
  `readout` answers `campaign.metric@1` ones.
- `vendor/workspace-sdk` is generated. Refresh it with `superwall workspaces update`.

Each API a workspace calls needs its read scope in `superwall.json`, or it answers 403 at run time:
`/v2/projects` needs `projects:read` and the SQL endpoint, `/v2/organizations/:id/query`, needs `data:read`.
`dev` warns when one is missing.

SQL works in an `org.page@1` and in a metric. A slot tied to one app, such as `app.page@1`, a widget, a tab or
a panel, can't run it, so give those the data through another API or an `org.page@1`.
