<p align="center">
  <a href="https://superwall.com/">
    <img src="https://user-images.githubusercontent.com/3296904/158817914-144c66d0-572d-43a4-9d47-d7d0b711c6d7.png" alt="Superwall" height="100" />
  </a>
</p>

<h1 align="center">@superwall/studio</h1>

<p align="center">
  The studio <code>superwall dev</code> opens: every paywall and funnel as a
  live card, and a device-frame editor with theme, locale, and variable
  overrides.
</p>

## Install

```bash
npm install @superwall/studio
```

Released to npm and mirrored to GitHub Packages (`npm.pkg.github.com`), so a
repository whose `.npmrc` scopes `@superwall` there resolves it as well.

You will not usually install this directly: the
[`superwall`](https://www.npmjs.com/package/superwall) framework depends on
it and `superwall dev` serves it. It is a standalone vite + React + Tailwind
app that is also a component library — one codebase, two hosts:

- **`superwall dev`** serves the BUILT app (`dist/`, assets under
  `/__studio/`) plus the data endpoint and preview mounts — the local studio.
- **The hosted studio** in the dashboard imports the component library
  (`dist/lib/`, the package's `.` export, plus the compiled
  `@superwall/studio/studio.css`) and renders `SurfaceEditor` over published
  snapshots and platform data. See [Hosting](#hosting).

## Package layout

```
packages/studio/
├── index.html            the app shell (fonts, favicon)
├── vite.config.ts        vite + react + tailwind; /__studio/ base for builds
├── vite.lib.config.ts    the library build: dist/lib/index.js + studio.css
├── tsconfig.lib.json     declarations for the library build
├── src/
│   ├── main.tsx          entry: fetch /__studio/project.json → <StudioApp/>
│   ├── index.ts          the component-library barrel a hosted studio imports
│   ├── StudioApp.tsx     URL-driven router (list ⇄ editor)
│   ├── screens/          SurfaceList, SurfaceEditor
│   ├── components/       StudioShell, TopBar, Toolbar, DeviceFrame, VariablesPanel,
│   │                     ActionMenu, CompareMenu, SidePanel, controls, icons, …
│   ├── lib/              project.ts (wire-format parser, untrusted JSON,
│   │                     cast-free), preview.ts (preview URL builder),
│   │                     devices.ts (viewport + mock-device catalog),
│   │                     actions.ts, events.ts, time.ts, types.ts
│   └── styles.css        tailwind @theme tokens + stateful primitives
└── dist/                 built by the workspace postinstall: the app, and
                          the library under dist/lib/
```

## Data seam

Everything renders from a `StudioSource` — `{ title, surfaces, diagnostics?,
samples?, previewUrl, capabilities? }`. Locally that's
`/__studio/project.json` (the dev server evaluates configs server-side and
ships sample device/user/params/product data alongside). A hosted studio
swaps the fetch, nothing else. `previewUrl(surface, overrides)` decides what
the preview iframes load: `/preview/<kind>/<id>` mounts locally, published
snapshot URLs in the dashboard. Overrides travel as query params (`theme`,
`locale`, `sw_device`, `sw_user`, `sw_params`, `sw_products`, `sw_trial`) —
the same channel published snapshots accept once opted in with
`?sw_preview=1`, so preview behavior is identical in both hosts.

## Hosting

The dashboard opens a code-first paywall in this studio instead of the visual
editor. What the library gives a host:

- `snapshotPreviewUrl(urlOf)` — a `previewUrl` that resolves each surface to
  its published snapshot URL, opts it into simulation (`sw_preview=1`), and
  appends the overrides. Every built snapshot boots through the framework's
  `PreviewHost`, which reads that channel, exposes `__swPreviewApply` for
  instant re-application (same origin only — cross-origin frames reload), and
  drives the studio bridge: paywall events and purchase/permission/callback
  prompts reach the host's toasts, and a `hello` message carries the
  paywall's locales, so `SurfaceEditor` fills its locale switcher when the
  host passes `locales: []`.
- One `StudioSurface` per version, told apart by `label` (`"v12 · live"`);
  `StudioSource.compareHint` names what the compare menu offers, and
  `SurfaceEditor`'s `actions` slot takes the host's own controls (a version
  switcher, say). With no `capabilities`, there is no push/promote UI.
- `StudioShell` (`position="absolute"` when the host owns the viewport) is
  the ink stage every screen expects, and it carries the `sw-studio` class
  the stylesheet scopes its base rules to.
- `@superwall/studio/studio.css` is compiled Tailwind v4 output including a
  preflight. Mount it in a shadow root (or an iframe) rather than beside
  another design system — the dashboard does exactly that, and re-registers
  the sheet's `@property` rules at document level, where browsers expect them.
- `@superwall/studio/products` is the pure mapping from a dashboard product
  (the v2 API shape) to the variables a paywall reads (`price`, `periodly`,
  `trialPeriodDays`, …). The CLI and the hosted studio share it, so the
  Variables panel shows the same numbers in both.
  `@superwall/studio/styles.css` is the Tailwind source for hosts that run
  their own v4 pipeline.

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

## Develop

This package lives in the [`superwall/superwall`](https://github.com/superwall/superwall)
monorepo. **Read [AGENTS.md](https://github.com/superwall/superwall/blob/main/AGENTS.md)
first** - the conventions in it are decided, not suggested.

```bash
bun install
bun dev               # the studio alone on port 6200, proxied to a running
                      # `superwall dev` (port 6100) in any project — HMR against
                      # real paywalls
bun run build         # dist/ (what `superwall dev` serves) and dist/lib/ (the library)
bun run test
bun run typecheck
```

The workspace `postinstall` builds `dist/`, so a fresh clone of the monorepo
has a studio to serve from the first `superwall dev`.

## License

[Functional Source License](https://github.com/superwall/superwall/blob/main/packages/superwall/LICENSE)
(FSL-1.1-ALv2): use it, modify it, embed it, ship it — anything except
building a competing product with it — and every release becomes Apache 2.0
two years after publication.
