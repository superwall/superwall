# `@superwall/studio`

The Superwall studio: a standalone vite + React + Tailwind app that is also
a component library. One codebase, two hosts:

- **`superwall dev`** serves the BUILT app (`dist/`, assets under
  `/__studio/`) plus the data endpoint and preview mounts — the local studio.
- **The hosted dashboard** either embeds the built app (the way it embeds the
  editor) or imports the components directly over platform data.

## App structure

```
packages/studio/
├── index.html            the app shell (fonts, favicon)
├── vite.config.ts        vite + react + tailwind; /__studio/ base for builds
├── src/
│   ├── main.tsx          entry: fetch /__studio/project.json → <StudioApp/>
│   ├── index.ts          the component-library barrel a hosted studio imports
│   ├── StudioApp.tsx     URL-driven router (list ⇄ editor)
│   ├── screens/          SurfaceList, SurfaceEditor
│   ├── components/       TopBar, Toolbar, DeviceFrame, VariablesPanel,
│   │                     ActionMenu, CompareMenu, SidePanel, controls, icons, …
│   ├── lib/              project.ts (wire-format parser, untrusted JSON,
│   │                     cast-free), preview.ts (preview URL builder),
│   │                     devices.ts (viewport + mock-device catalog),
│   │                     actions.ts, events.ts, time.ts, types.ts
│   └── styles.css        tailwind @theme tokens + stateful primitives
└── dist/                 built by the workspace postinstall
```

Working on the studio: `bun dev` here (port 6200) proxies `/preview` and
`/__studio/project.json` to a running `superwall dev` (port 6100) in any
project — edit studio code with HMR against real paywalls.

## Data seam

Everything renders from a `StudioSource` — `{ title, surfaces, diagnostics?,
samples?, previewUrl, capabilities? }`. Locally that's
`/__studio/project.json` (the dev server evaluates configs server-side and
ships sample device/user/params/product data alongside). A hosted studio
swaps the fetch, nothing else. `previewUrl(surface, overrides)` decides what
the preview iframes load: `/preview/<kind>/<id>` mounts locally, published
snapshot URLs in the dashboard. Overrides travel as query params (`theme`,
`locale`, `sw_device`, `sw_user`, `sw_params`, `sw_products`, `sw_trial`) —
the same channel published snapshots accept, so preview behavior is
identical in both hosts.

## Screens

- **SurfaceList** — every paywall and funnel as a card with a live,
  non-interactive miniature (a real preview at 393×852, scaled).
- **SurfaceEditor** — the paywall alone on an ink stage in one plain device
  frame, with a single bottom toolbar: device switching (`STUDIO_DEVICES`:
  nine devices, iPhone SE to iPad Pro to Pixel to Desktop — each switch also
  flips the mock SDK's platform/model/OS), light/dark simulation, locale
  switching, and a **Variables** button that slides in a right-hand panel of
  controls for the User, Device, Params and Products groups the SDK reports.
  Override changes hot-swap: the next frame loads hidden and crossfades, so
  nothing ever flashes white. Shipping happens here too: an action menu runs
  Push, Publish and Promote, and a Compare menu diffs the preview against
  the live paywall.

## Design

The Application register of the Superwall design system
(superwall.com/design.md): ink-dark chrome always (the _preview_ carries
light/dark, not the studio), hairline seams, mono chips, Manrope 500/400/600
with Roboto Mono micro-labels, teal accent, and paper-flat square geometry —
switches are the only carved-out rounded shape, device frames are plain
rectangles.

Tailwind v4 (`src/styles.css`): design tokens as `@theme` variables (so
`bg-ink`, `text-cream/55`, `border-cream/10` are utilities), layout inline in
components, and only stateful primitives (`.sw-btn`, `.sw-chip`,
`.sw-select`, `.sw-segmented`, `.sw-switch`, `.sw-input`) as component
classes. Runtime dependencies are React (a peer) and `sonner` for toasts —
icons are inlined Lucide-geometry SVGs.
