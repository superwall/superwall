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
│   │                     actions.ts (the dev server's shipping seam),
│   │                     promotion.ts (promote vs roll back), steps.ts,
│   │                     events.ts, time.ts, types.ts
│   └── styles.css        tailwind @theme tokens + stateful primitives
└── dist/                 built by the workspace postinstall: the app, and
                          the library under dist/lib/
```

## Data seam

Everything renders from a `StudioSource` — `{ title, surfaces, diagnostics?,
samples?, previewUrl, actions? }`. Locally that's
`/__studio/project.json` (the dev server evaluates configs server-side and
ships sample device/user/params/product data alongside) plus
`devServerActions`, the `/__studio/action` and `/__studio/status`
implementation of the shipping seam. A hosted studio swaps the fetch and the
seam, nothing else. `previewUrl(surface)` decides what the preview
iframes load: `/preview/<kind>/<id>` mounts locally, published snapshot URLs
in the dashboard. Both carry `?transport=editor`, which makes the paywall
talk to its parent window, and the studio is that parent.

The studio is a paywall host in the SDK's sense, through `@superwall/host`.
Each `DeviceFrame` answers its paywall's `ping` with the same burst the web
host sends (`template_variables`, `experiment`, `products`,
`template_substitutions_prefix`, `paywall_open`), built from the host state
`SurfaceEditor` assembles: the API's device and user samples (or the host
package's defaults), the selected device frame's `platform`/`deviceModel`/
`osVersion`, the theme as `interfaceStyle`, the chosen locale as
`deviceLocale`, one product per slot with the catalogue's variables (or the
visual editor's example prices for a slot the catalogue cannot price), and
whatever the Variables panel edits on top. Every edit re-sends only what
changed; nothing reloads. Purchases, restores, permissions and callbacks come
back as prompts in the toasts and are answered with the messages the iOS SDK
sends. Nothing about this is specific to the studio: the paywall cannot tell
it from a device.

## Hosting

The dashboard opens a code-first paywall in this studio instead of the visual
editor. What the library gives a host:

- `snapshotPreviewUrl(urlOf)` — a `previewUrl` that resolves each surface to
  its published snapshot URL and adds `transport=editor`. Set
  `paywallId`, `paywallIdentifier`, `products` and `locales` on each
  `StudioSurface` from the paywall and version records; the studio hosts the
  snapshot from them. `hostStateFor` and `hostPatch` are exported for a host
  that wants to drive a `DeviceFrame` itself.
- One `StudioSurface` per version, told apart by `label` (`"v12 · Live"`)
  and carrying its `version`; `StudioSource.compareHint` names what the
  compare menu offers, and `SurfaceEditor`'s `actions` slot takes the host's
  own controls (a version switcher, say).
- `StudioSource.actions` is the shipping seam: `offered` names the actions
  the host can run (`push`, `promote`, `publish`), `run(surface, { action,
version? }, onStep)` performs one and streams its steps, `status(surface)`
  lists the pushed versions with the live one marked. With none, there is no
  push/promote UI. The pushed versions sit in a picker at the start of the
  action button group, and the studio labels the button **Promote** or
  **Roll back** by where the picked version sits against the live one
  (`promotionDirection`). A host that can only promote (the dashboard, which
  has no project on disk) offers `["promote"]` and a `pick` that switches the
  surface, so the menu collapses to the picker and one button; the local
  studio keeps its own pick and sends a `version` only when one was chosen.
- A hosted surface with no `paywallId` whose host offers `push` is not in
  the account yet (an agent's unpushed build). It ships through the same
  action menu (`["push", "publish"]`, with `status` listing no versions),
  and Preview asks to push it first, then runs `push` with `resume:
"preview"` in the request. A host that moves to the saved surface passes
  that on as `SurfaceEditor`'s `resume`, which opens Preview there once and
  calls `onResumed`. The screenshot stays disabled until a version is live.
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
- `@superwall/studio/contract` is a types-only entry: the action, status,
  samples and app-scheme shapes the CLI implements for the framework's
  preview server, importable from node without DOM types.
  `@superwall/studio/styles.css` is the Tailwind source for hosts that run
  their own v4 pipeline.
- `SurfaceEditor`'s `ref` is a `StudioHandle`: `run(commands)` applies
  `StudioCommand`s (zoom, device, size, orientation, theme, locale,
  introductory offer, a Variables panel value, reset, the Variables panel,
  version, compare, reload) through the same state the toolbar drives, and
  resolves once the stage has settled with `{ ok, errors, state }`;
  `state()` reads the same `StudioState` without changing anything. Commands
  that arrive as untrusted JSON (an agent's, over a bridge) go through
  `parseStudioCommands` first. A bad command is reported by index and the
  rest still apply. Zoom applies after everything else, so it lands on the
  stage a device or orientation change refits.
- `SurfaceEditor`'s `panel` (`{ open, label, content, width?, onWidthChange? }`)
  is a host-owned panel at the start of the editor's row, from under the top
  bar to the bottom of the studio; the stage and its toolbar sit to its right.
  The Variables panel mirrors it on the right, also full height, so the
  toolbar spans only the stage column between the two. The
  dashboard puts the agent chat's slot there. It opens like the Variables
  panel, by growing its width (`ease-drawer`, the move duration, none under
  reduced motion), while its content keeps its width pinned to the inner
  edge, so the content slides in and the canvas refits beside it. Its right
  edge resizes it: drag it (mouse, touch or pen), or focus it (a
  `separator`) and use the arrow keys; Home and End go to the minimum and
  maximum, a double click back to the default 368px. It stays between 320px
  and 60% of the row, always leaves the stage 400px beside the open
  Variables panel, and takes the whole row (no handle) below 576px. The
  width is remembered in localStorage (`sw-studio-panel-width`); a host that
  passes `onWidthChange` owns it instead, through `width` (undefined is the
  default). `HostPanel` is exported for hosts that lay out their own row
  (a size container, `@container`).

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
  Push, Publish and Promote beside a picker of the pushed versions, reading
  **Roll back** when the picked one is older than what is live, and a Compare
  menu splits the stage against any pushed version of the paywall (the live one
  marked) or another local one. The progress panel a run opens closes like
  any popover (outside click, Escape, focus or the window leaving); the
  action button or its chevron brings a running one back, and a failure
  reopens it. When the stage changes size (a side panel opening or closing,
  a resize), the device goes back to the middle: refitted if the user only
  panned, re-centred at their zoom if they zoomed.

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
