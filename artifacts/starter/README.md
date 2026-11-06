# Artifact starter

An artifact is a small Worker that adds to the Superwall dashboard: a page, a panel, or a metric in
Charts. It holds no credential and calls Superwall as whoever is viewing it.

    superwall artifacts dev                         # http://localhost:8790 against your real data, read-only
    superwall artifacts try transactions --app <id> # the metric on the real runtime
    superwall artifacts try home                    # the page in the dashboard
    superwall artifacts push                        # build it; only you see it until an admin approves it

- `superwall.json` says what it does: its scopes and entrypoints.
- `src/worker.ts` is the server code. `fetch` serves pages, `metric` answers `chart.source@1` entrypoints and
  `readout` answers `campaign.metric@1` ones.
- `src/client.tsx` is the page's browser code. `client.entry` in `superwall.json` names it, and `dev`, `try` and the
  builder bundle it the same way, with React's JSX, TypeScript, CSS imports, and images and fonts as data URLs. `baseUrl`
  and `paths` in the root `tsconfig.json` apply to browser code and the Worker alike, so `@/` imports work in both. Keep
  them in that one file: `extends` and a `tsconfig.json` in a subfolder are refused for an artifact with browser code.
  There is no build script, so PostCSS and Tailwind need their CSS committed.
- `superwall.artifact.json` appears on the first push and links this project to its artifact. Commit it.
- `vendor/artifact-sdk` is generated. Refresh it with `superwall artifacts update`.

Each API an artifact calls needs its read scope in `superwall.json`, or it answers 403 at run time:
`/v2/projects` needs `projects:read` and the SQL endpoint, `/v2/organizations/:id/query`, needs `data:read`.
`dev` warns when one is missing.

A slot tied to one app, such as `app.page@1`, a widget, a tab or a panel, reaches fewer routes: only ones for that
app. `/v2/projects` and SQL answer 403 there with "Artifacts may not call this endpoint.", in `dev` too, so give those
the data through a route like `/v2/users`, or use an `org.page@1`.
