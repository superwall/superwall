# Workspace starter

A workspace is a small Worker that adds to the Superwall dashboard: a page, a panel, or a metric in
Charts. It holds no credential and calls Superwall as whoever is viewing it.

    superwall workspaces dev                         # http://localhost:8790 against your real data, read-only
    superwall workspaces try transactions --app <id> # the metric on the real runtime
    superwall workspaces try home                    # the page in the dashboard
    superwall workspaces push                        # build it; only you see it until an admin approves it

- `superwall.json` says what it does: its scopes and entrypoints.
- `src/worker.ts` is the server code. `fetch` serves pages, `metric` answers `chart.source@1` entrypoints and
  `readout` answers `campaign.metric@1` ones.
- `src/client.tsx` is the page's browser code. `client.entry` in `superwall.json` names it, and `dev`, `try` and the
  builder bundle it the same way, with React's JSX, TypeScript, CSS imports, and images and fonts as data URLs. There
  is no build script, so PostCSS and Tailwind need their CSS committed, and `paths` in `tsconfig.json` don't apply
  in browser code.
- `superwall.workspace.json` appears on the first push and links this project to its workspace. Commit it.
- `vendor/workspace-sdk` is generated. Refresh it with `superwall workspaces update`.

Each API a workspace calls needs its read scope in `superwall.json`, or it answers 403 at run time:
`/v2/projects` needs `projects:read` and the SQL endpoint, `/v2/organizations/:id/query`, needs `data:read`.
`dev` warns when one is missing.

A slot tied to one app, such as `app.page@1`, a widget, a tab or a panel, reaches fewer routes: only ones for that
app. `/v2/projects` and SQL answer 403 there with "Workspaces may not call this endpoint.", in `dev` too, so give those
the data through a route like `/v2/users`, or use an `org.page@1`.
