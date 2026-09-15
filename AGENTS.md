# AGENTS.md

Guidance for coding agents (and humans) working in this repository.

## About this repo

Superwall for Agents: the superwall framework, for building paywalls and web
funnels as mini React apps with file-based routing. Superwall provides
products, purchases, localization, trials, and the bridge to the native SDKs
(iOS / Android / Flutter / React Native — no native SDK changes required; this
speaks the same message protocol as the paywalls built in Superwall's visual
editor). The framework is designed to be authored by coding agents as much as
by people: borrow conventions agents already know, invent nothing plain React
already covers.

Style the name as `superwall`, lowercase, in user-facing copy and docs.
"Superwall" (capitalized) refers to the platform/service.

## Companion repos — docs and skills ship with every change

This repo carries no user documentation of its own. The framework's docs live
in [superwall/docs](https://github.com/superwall/docs) under
`content/docs/framework/`, and the agent playbook in
[superwall/skills](https://github.com/superwall/skills) under
`skills/superwall-framework/` (`SKILL.md` + `references/`). Both are
conventionally checked out beside this repository (`../docs`, `../skills`) —
find them there rather than assuming an absolute path. A change here that
alters behavior, a command, a flag, a config key, an error message, or a file
format is not finished until the matching docs page(s) and skill file(s) are
updated in the same pass; treat the three repos as one deliverable and say in
the hand-off which pages and references changed.

## Project conventions (what the framework serves)

Everything Superwall-related in a user's repo lives in a `superwall/`
directory (or the repo root for dedicated repos). That directory is a real,
self-describing npm project — clone it, install, `superwall dev`:

- `superwall/package.json` + lockfile + `node_modules` — the project owns its
  own npm world (framework, react, react-dom), so a pure-native iOS/Android
  repo needs no npm scaffolding at its root. It is also the **marker**: a
  directory is a superwall project when its `package.json` depends on
  `superwall`. There is no project-level config file. The CLI scaffolds the
  `package.json` and a `.gitignore` write-if-absent. The package must never
  be named `superwall`: Node's self-reference rule would capture every bare
  `import "superwall"` inside it, and discovery hard-errors on it.
- **No project-wide defaults.** Each surface's `config.ts` is the whole truth
  for that surface; nothing is inherited or merged from above. Shared settings
  are composed explicitly — export a plain object, spread it into
  `definePaywall`.
- `superwall/components|messages|assets/` — the shared design system, strings
  (auto-discovered per locale, inherited by every surface), and assets. All
  three also work per-surface, inside `paywalls/<id>/`.
- `superwall/paywalls/<id>/` and `superwall/funnels/<id>/` — each surface is a
  mini React app: a **required** `config.ts` (`definePaywall`: the dashboard
  `name`, its products, and every paywall setting — presentation style,
  feature gating, on-device cache, scrolling, game controller. A headless
  paywall has no dashboard editor, so `config.ts` is the only source:
  `paywallSettingsOf` (the framework's `build/settings.ts`) resolves them — together with the web checkout destination and
  background — at build, the version push carries them, promote stamps them
  onto the paywall columns SDKs read, and an omitted key resets to its
  default. Products are the one per-platform field and travel separately. A surface without `config.ts` is invalid; product data comes from
  Superwall alone, never from the file) + an `app/` route tree (**routes only**: every `.tsx` is a
  route, directories prefix the name, `index.tsx` is the entry, and `layout.tsx`
  is the one reserved name — anything else in `app/` is a diagnostic telling you
  to move it to `components/`) + local `components/` and `messages/`
- `superwall/superwall.lock` — the binding map, and the only metadata file in
  the tree: `apps` maps each platform (`ios`, `android`, `web` — one Superwall
  app per platform) to its app id, and each
  surface binds to one paywall ID **per platform**. A surface picks its
  platforms with `platforms: [...]` in `config.ts` (a typed literal union,
  `SuperwallPlatform`); optional while the project is on one platform,
  required once it pushes to several — push refuses to guess, and there is
  no project-wide default. A product slot may carry one store id per
  platform (`annual: { ios, android, web }`) behind a single reference; a
  platform build resolves it and rewrites the `products` literal in the
  config module (`rewriteConfigProducts`, via rollup's AST) so other
  platforms' ids don't ship; products reached through a spread keep the entry
  override only. Dev builds keep the map live so the session resolves it by the device the host reports.
  A platform the slot doesn't name is refused. Every (surface, platform) pair is its own build
  (asset host is per app, product ids per platform), version history
  (`play-store` on android), and source commit. Publish-time
  facts live in commit trailers,
  not on disk. **It is the binding of record**: a directory rename is detected
  (a bound id that no longer exists on disk, beside an unbound directory), never
  guessed — push prompts interactively, hard-errors in CI, and refuses to create
  a second paywall while an orphaned binding exists. The repeatable
  `--rename <old>=<new>` flag on push/publish is the non-interactive escape. A
  binding no rename claims is offered for removal interactively (lock-only —
  the paywall keeps serving, and restoring the directory re-binds it); a
  non-interactive run never mutates the lock without consent. The lock's
  optional `origins` section (`"paywall/<id>": { paywallId, url }`) is
  written by `superwall create --from <paywall-id>` — the dashboard
  (editor) paywall a surface was rebuilt from and the document it serves.
  It is never a binding (both lock readers keep it apart from
  `paywalls`/`funnels`); the framework passes it to the studio as
  `origin`, which offers it as **Compare › Original**, a view-only pane
  (the editor runtime does not speak the studio's host protocol). The
  deterministic half of a migration — `config.ts` from the API row plus
  the `paywall`/`paywall_language` records of the editor store embedded in
  the served document (`vike_pageContext`), and a `MIGRATION.md` brief with
  the inventory — is `packages/cli/src/core/paywalls/project/origin.ts`;
  the rebuild is the framework skill's `migrate-from-editor.md`. The same
  section also holds native-screen origins
  (`{ path, framework, screenshot? }`, written by `superwall migrate
--screen <path>`): `packages/cli/src/core/paywalls/screen.ts` is the
  scanner (string literals, assets, product ids and actions per language,
  the candidate ranking, `config.ts` and the brief), the screenshot the
  CLI captures from a booted simulator is `paywalls/<id>/original.png`,
  served by the preview server at `/__studio/original/<kind>/<id>` and
  shown by the studio as an image pane; the rebuild playbook is the
  framework skill's `references/migrate-from-native.md` with one
  `references/native/<framework>.md` per source framework.
- Identity is the path. No name fields, no registration, and user projects
  never contain vite configs, index.html, or build tooling — the framework
  owns bundling. `@/…` aliases the `superwall/` directory.
- **Self-containment is allowed but recorded**: an import resolving outside
  the project (and outside `node_modules`) still builds, but push warns once
  naming each offender and stamps `Superwall-Portable: false` +
  `Superwall-External` on the commit, so the dashboard can grey out remote
  editing with a reason instead of failing.

Commands resolve the framework from `<cwd>/superwall/` first, then `<cwd>`,
so they work from the host root and from inside the directory alike; `.env` is
read from both, the project's own file winning.

## Repository layout

The stack, bottom to top — each layer depends only on the one below it:

- `packages/protocol` — `@superwall/protocol`: the SDK ↔ paywall message
  contract (zod message schemas, the envelope, and the transports).
  **Backward compatibility is sacred here**: old app binaries with old native
  SDKs load new paywall bundles indefinitely. Additive changes only.
- `packages/runtime` — `@superwall/runtime`: framework-agnostic runtime on top
  of the protocol, the paywall side only. **No React imports allowed.** Hosts
  (the SDKs, the web host, `@superwall/host`) deliver everything in a
  snapshot; the runtime merges and derives, never invents. Layout:
  - `src/bridge/` — the wire: transport detection (`?platform=android`,
    `?transport=editor`, else WebKit), `detectSuperwallHost`, base64 batch
    decoding for `accept64`
  - `src/config/` — the `SuperwallConfig` contract a running paywall reads,
    one file per concern (`products`, `checkout`, `presentation`,
    `background`, `insets`, `notifications`, `localization`). Push-time concerns (the
    settings wire, document attributes) live in the framework, not here.
  - `src/localization/` — `locale.ts` (resolution), `catalog.ts` (`t()`),
    `periods.ts` (the editor's period translation table from
    `pwn/packages/schema/src/editor/swschema/products/localizations.ts`,
    copied verbatim; its lookup code is the editor's, trimmed of unreachable
    branches so it can be covered completely)
  - `src/products/` — the product model (`reference`, `productId`,
    `variables`, `source`), `merge.ts` (`products` + `template_variables`,
    including the iOS template's top-level `primary`/`secondary`/`tertiary`),
    `derive.ts` (localized `period`/`periodly`, `trialPeriodEndDate`)
  - `src/session/` — `createSuperwallSession` (a factory over the raw
    transport) composed from `outgoing.ts` (message builders, mirror of the
    host package's `messages/`), `purchases.ts` (pending purchases, timers,
    attribution), `requests.ts` (permission/callback correlation and the
    paywall.js request-id format), `reminders.ts` (trial reminder
    scheduling), `incoming.ts` (the pure snapshot reducer), `state.ts` (the
    object `window.app.getAllState()` returns to the iOS SDK, in paywall.js's
    shape), `variables.ts` (device/user/params types mirroring the iOS
    `DeviceTemplate`), `types.ts` (the covariant `SuperwallSession`
    interface and the snapshot)
- `packages/superwall` — `superwall`, THE framework. The public surface is
  split by concern, and no subpath entry may import the root barrel:
  `.` (slim: `SuperwallProvider`, its props, and the runtime types) ·
  `./config` · `./hooks` · `./navigation` · `./checkout` · `./assets`
  (types only) · `./internal` (message merging the generated entry needs —
  not public) · `./build|./preview|./discover` (the CLI's tooling contract).
  - `src/config/` — the authoring contract: `definePaywall` (`paywall.ts`),
    surface config loading (`load.ts`), message merging (`messages.ts`,
    re-exported through `src/internal.ts`)
  - `src/checkout/` — `superwall/checkout`: web checkout (Stripe). The build
    mounts it only when `config.checkout` is `sheet` or `applePay`
    (`build/index.ts`), so a store-only paywall carries none of it. One
    directory per part; the root holds only the entry, the shared vocabulary
    and the orchestrator, and there is no `services/`, `utils/` or
    `constants.ts` drawer — a tunable lives in the module it tunes:

    | Root          | Owns                                                                      |
    | ------------- | ------------------------------------------------------------------------- |
    | `index.tsx`   | `SuperwallCheckout` and the module's public exports                       |
    | `types.ts`    | the domain: modes, session directives, discounts, post-purchase behaviour |
    | `flow.ts`     | the orchestration, below                                                  |
    | `products.ts` | the Stripe product-identifier vocabulary                                  |
    | `events.ts`   | the in-page bus between the flow and the sheet (public `checkoutEvents`)  |
    | `loading.ts`  | the loading-overlay flag                                                  |
    - `flow.ts` is the only orchestrator: it holds one `session` source and one
      `applePay` per paywall (`sessionsFor`, `applePayFor`, keyed by the runtime
      session in a `WeakMap`) and owns every sequence a purchase can take —
      `prefetchSession`, `purchaseOnWeb`, `purchaseWithApplePay`,
      `openEmbeddedSheet`, `openHostedCheckout`/`watchHostedCheckout`,
      `reportCompletedCheckout`/`watchCompletedCheckouts`,
      `redeemDiscount`, `clearDiscount`, `invalidateSessions`, `reprefetch`. A
      paywall hook calls into it and never drives checkout itself.
      `PaywallSession` is the narrowed runtime session; a _checkout_ session is
      always spelled out (`EmbeddedCheckoutSession`, `CheckoutSessionResult`).
    - `session/` is where a checkout session comes from: `index.ts`
      (`createCheckoutSessions` — asks the backend, dedupes in-flight requests,
      applies a promotion code to what it creates), `cache.ts` (its own cache,
      owned per paywall, so two paywalls in one page cannot share one), `id.ts`
      (the `sw_checkout_` codec, which is also where an embedded session's
      Stripe client secret comes from).
    - `api/` is the only place that touches the subscriptions API: `url.ts`
      (environment), `fetch.ts` (retry — a 4xx is the backend's verdict and
      throws at once, as paywall.js does), `body.ts` (the v4 session body and
      identity), `decode.ts` (**a trust boundary**: every response is read
      field by field, never cast).
    - `host/` is the native SDK side: `index.ts` builds what the SDK hears
      (`initiate_web_checkout`, `stripe_checkout_*`, `discount_redemption_result`,
      the redemption `open_deep_link`) — that is how the SDK tracks, dismisses
      and grants access for a web purchase, so keep both sheets reporting
      identically — and `sdk.ts` holds the version gates paywall.js also
      applies: below 4.10.8 an SDK cannot host payment, so the same
      `purchase()` sends the shopper to the hosted page and nothing is
      prefetched; below 4.14.0 it does not redeem a completed purchase, so the
      flow asks `checkout/session/complete` for a link and hands it back.
      Completion is reported from exactly one place
      (`reportCompletedCheckout`), so the sheet, the wallet and the hosted page
      cannot drift. A hosted page is opened by the SDK and watched by polling
      `checkout/status` every two seconds for two minutes, as paywall.js does;
      only with no SDK there does the page navigate to it itself.
    - `discount/` is everything about promotion codes: `store.ts` (the applied
      code, reached as `sessions.discounts`), `pricing.ts` (per-product
      amounts) and `money.ts` (minor-unit formatting). A code is forwarded
      only on sessions for the products the backend said it applies to — a
      paywall can mix Stripe environments, and a refused session that carried
      the code drops it paywall-wide. `useDiscount` is the public surface and
      hands back **Stripe's own coupon vocabulary** (`percentOff`, `amountOff`,
      `duration`, `durationInMonths`) plus the amounts that had to be computed;
      it invents no summary of its own. The host's `redeem_discount` reaches
      the same `flow.redeemDiscount`.
    - `applePay/` is the wallet: `index.ts` (`createApplePay`) opens the native
      sheet through Stripe's PaymentRequest and falls back to the embedded
      sheet where the device cannot pay. It is built from the backend's
      deferred `elements` quote (no Stripe object until the wallet authorizes;
      `checkout/session/confirm` creates the subscription), so `session/`
      asks for `elements` with `deferElementsIntentCreation` only in
      `applePay` mode. `request.ts` quotes trials and intro offers as Apple's
      `recurringPaymentRequest` with a `trialBilling` line — that is what makes
      the sheet say "Free Trial" — and shows an applied code as line items.
    - `sheet/` is the payment UI and its stylesheet: `Sheet.tsx` (root),
      `SheetShell.tsx` (portal, backdrop, insets), `SheetCard.tsx`,
      `LoadingOverlay.tsx`, `state.tsx`/`reducer.ts` (which session is open),
      `device.ts`. The shell reads what it needs off the snapshot and the
      config — `deviceModel` for the safe-area inset and corner radius, the
      paywall's presentation style for whether it lays out fullscreen, the same
      derivation v4 makes. Nothing about the sheet is a prop a paywall can set.
    - `hooks/` is what the host drives: `useAutoPrefetch`,
      `useCheckoutCompletion`, `useHostDiscount`.

  - `src/hooks/` — the specialized hooks (`useProducts`, `usePurchase`,
    `useDiscount`, `useActions`, `useTranslation`, …), one file each; the
    barrel also carries `createSuperwall` and `useSuperwallSession`
  - `src/provider/` — `SuperwallProvider` + session context (`context.ts`)
    and the typed `createSuperwall` factory (`create.ts`)
  - `src/navigation/` — `superwall/navigation`: the route stack behind the
    file-based `app/` tree (`useRouter`, `useIsFocused`, `PaywallRouter`).
    Routes are names, never paths — one bundle, no network on navigate; the
    stack stays mounted (and `inert`) so a pop restores state, and each
    navigation reports `page_view`. Names are typed via the CLI-generated
    `superwall.d.ts`, which augments the `SuperwallRoutes` interface and
    carries the asset-module reference. `motion.ts` holds what the router
    reads back off the DOM (how long the running animations last, freezing an
    interrupted layer where it sits, reduced motion); `assets.ts` reads the
    route-asset map the build stamps into the document and warms it. The
    router itself owns only the stack.
  - `src/discover.ts` — filesystem discovery (`superwall/` dir conventions),
    including the project `marker`. It never throws — a markerless directory
    is a valid answer; the CLI's `requireProject` is what fails loudly.
  - `src/lock.ts` — read-only view of `superwall.lock` (the CLI writes it)
  - `src/document.ts` — **the artifact contract**: the HTML a paywall _is_
    (`renderDocument`, `data-sw-*` semantics) and the platform layer the
    runtime wraps it in (`injectPlatformLayer`). The build and the preview
    server both render through it, so local and published are the same
    document. Nothing else may enter it. It owns both kinds of `data-sw-*`
    attribute: `documentAttributes` (static, from `config.ts` — generation,
    scroll, presentation — rendered into the HTML and reasserted by the
    provider) and `hostAttributes` (live, from the device the host reports —
    platform, idiom, cutout — stamped by the provider, absent when the host
    has said nothing, never guessed).
  - `src/device.ts` — what the framework knows about devices from the
    variables a host sends: `platformOf`, `idiomOf`, `cutoutOf` (the iPhone
    model tables). The checkout sheet's corner radius and the inset floors
    both derive from it; nothing else keeps a model list.
  - `src/provider/insets.css` — the inset system. The router wraps the
    whole paywall in `[data-sw-root]` (`navigation/routes.css`), a flex
    column at `100dvh` padded by `--sw-inset-*`, with `[data-sw-content]`
    inside it as the positioned containing block for layout chrome, so
    layouts and pages are inside the safe area by default, an absolute
    `top: 0` in a layout is the top of the inset area, and
    `--sw-routes-height` defaults to `auto`. `[data-sw-routes]` then
    reaches back out under the insets with negative margins and each
    `[data-sw-route]` (the scroll container) carries them as padding
    (`--sw-page-inset-*`, = the insets), so pages scroll edge to edge
    like a native scroll view with a content inset and a sticky footer
    sticks above the home indicator; a layout with its own footer below
    the pages sets `--sw-page-inset-bottom: 0`. `--sw-bleed` /
    `--sw-page-bleed` are the negative insets for overlays that must
    cover the bars.
    `config.insets` (runtime `config/insets.ts`, `insetsOf`) is written
    inline on `<html>` by the provider; an edge it leaves at `"safe-area"`
    falls through to the stylesheet, where `--sw-inset-*` defaults to
    `--sw-safe-area-inset-*` = `max(env(safe-area-inset-*),
--sw-safe-area-floor-*)`, and the floors key on the `data-sw-*`
    attributes above (iOS cutout/idiom/orientation, Android's status bar,
    the presentation style). Fixed chrome that means to sit over the bars
    reads `--sw-safe-area-inset-*`, never `--sw-inset-*`. Every rule has
    bare `:root` specificity (`:root:where([…])`) and lands before the
    paywall's stylesheet so a paywall's own `:root` declaration wins. The
    floors are minimums per device class, never exact values, so a real
    `env()` is never shrunk. Android's come from the SDK's layout: a
    fullscreen paywall is drawn under the status bar, and the SDK margins
    the webview above the navigation bar itself, while Android WebView
    reports no `env()` for either.
  - `src/build/` — `superwall/build`: one surface → one self-contained,
    content-addressed HTML snapshot. `index.ts` drives vite; `entry.ts`
    generates the entry a surface mounts, `assets.ts` collects and
    content-addresses hosted assets (and attributes them per route),
    `products.ts` resolves per-platform product ids and bakes them into the
    snapshot's own config, `settings.ts` turns `config.ts` into the version's
    settings wire (`paywallSettingsOf`)
  - `src/preview/` — `superwall/preview`: serving surfaces locally the way
    the runtime serves published snapshots — `server.ts` (vite; studio dist,
    project payload, surface previews, the `/device/manifest.json` the iOS
    SDK's dev mode reads), `projects.ts` (its pure parts: discovery per root,
    the virtual project module, dependency and PostCSS resolution),
    `mount.tsx`/`surface.tsx` (what runs inside the iframe: the same
    `SuperwallProvider` a built entry mounts, hosted by the studio over
    `?transport=editor`), `project.ts` (the project payload the studio loads,
    with the host defaults for unsampled data), `device.ts` (the manifest),
    and `webview.ts` (the one deliberate local-only difference). No preview
    code ships in a snapshot; a paywall cannot tell the studio from a device.

- `packages/cli` — `@superwall/cli`: THE command surface (integrate/migrate/
  review, apps, products, campaigns, query, ASC, ASA, auth, telemetry; yargs + ink)
  **plus the paywall commands** (`create`, `dev`, `push`, `promote`, `publish` in
  `src/commands/paywalls/`, shared machinery in `src/core/paywalls/`).
  Paywall commands load the framework dynamically from the project's own
  install (`core/paywalls/project/framework.ts`) — the CLI never
  hard-depends on a framework version, and commands always run against the
  project's lockfile. It owns **no bin** — it exports `main()`, and the
  framework's `superwall` bin (prefer-local launcher + tsx + project `.env`)
  starts it. The launcher registers tsx against the superwall project's own
  `tsconfig.json` (or none), never the host app's: an app's `paths` (the
  dashboard maps `@superwall/studio/*` onto a vendored `.d.ts`) would
  otherwise redirect the CLI's imports. Dependency direction: framework → cli for the bin, cli →
  framework only dynamically at command runtime. This package is **excluded
  from oxfmt/oxlint** (it keeps its own conventions — see its `AGENTS.md`)
  and is consumed **built** (tsdown → `dist/`; root `postinstall` builds it).
- `packages/host` — `@superwall/host`: the other half of the SDK ↔ paywall
  conversation, so anything can play the SDK's part. `createWindowHost({ target,
state, delegate })` answers the handshake, streams variables as a patch, and
  asks a `delegate` for every outcome a device would decide (purchase, restore,
  permission, callback). It is what makes a preview indistinguishable from an
  app: the paywall speaks one protocol and never learns who is listening.
  `state.ts` owns both halves of the wire — `diffHostState(previous, next)`
  produces a patch and `mergeHostState(state, patch)` applies one, held together
  by a round-trip test, so no consumer reimplements the diff (the studio did,
  until pass H).
- `packages/studio` — `@superwall/studio`: the preview UI around that host —
  device frames, theme/locale/orientation switches, the variables panel, the
  outcome prompts, the surface list. A component library, not an app: its only
  wiring to a paywall is `HostedIframe`, which calls `createWindowHost` on the
  iframe's `contentWindow` and sends `hostPatch(sent, next)` diffs as state
  changes.
  - **Two hosts mount it**, and the seam between them is one type,
    `StudioSource` (title, `StudioSurface[]`, `previewUrl(surface)`):
    `superwall dev` supplies surfaces discovered on disk and previews
    `/preview/{kind}/{id}?transport=editor`, while the dashboard
    (`../pwn/apps/web2`) supplies pushed versions and previews the immutable CDN
    snapshot. Same component, same protocol, same paywall bytes — only the
    surface list and the URL differ.
  - Anything the **hosted** studio needs has to travel through the push
    payload, because the dashboard has no access to the repo. That is why a
    pushed version carries `locales` (and why the device manifest carries
    `settings`): locally the studio reads the project, hosted it can only read
    what push recorded.
  - `src/lib/products.ts` is a **hand-rolled mirror** of the dashboard's
    canonical engine (`ProductVariables` in pwn's unpublished
    `@superwall/schema-next`), used only on the local path — the CLI feeds its
    output in as the catalogue. Its period-unit rounding is deliberately
    non-uniform because theirs is: days exact, weeks rounded, months and years
    floored. Do not "simplify" it; the fix is the V2 paywall response resolving
    variables server-side so both engines go away.
  - `src/lib/contract.ts` is the **dev-server ↔ studio contract**, exported as
    the types-only entry `@superwall/studio/contract` (a `types` field, no
    `default`): the shapes of `/__studio/action`, `/__studio/status`,
    `/__studio/samples.json` and the app-scheme lookup. The CLI implements the
    server side and the framework's `preview/server.ts` serves it, so both need
    the shapes without importing the studio's React code — hence types-only.
    `src/lib/surfaces.ts` is the studio's own domain (`StudioSurface`,
    `StudioSource`) that either host fills in; everything else in `lib/` is
    studio-internal.
  - `src/lib/` keeps its name on purpose: its modules are each named for what
    they own, and the package's public entries (`@superwall/studio/contract`,
    `/products`) point into `dist/lib/lib/*`, which the dashboard's tsconfig and
    vite alias resolve. Renaming it breaks the dashboard until it re-vendors.
- `examples/*` — each example **is** a superwall project directory (not an
  app repo with one inside): `package.json` and its paywall at the root.
  Using one means copying the directory into a real app as `superwall/`.
  This also keeps bare-repo-root discovery exercised continuously. `bun dev`
  from the repo root serves all of them through the studio.

Each package has a README with its full API. Read it before changing the
package.

## Commands

Requires bun ≥ 1.3. From the repo root:

```sh
bun install
bun dev                 # studio over every example on http://localhost:6100
bun run test            # all package test suites (vitest; the CLI uses node's test runner)
bun run test:coverage   # with v8 coverage
bun run typecheck       # tsc --noEmit across packages
bun run lint            # oxlint
bun run format          # oxfmt
bun run build           # built output for the packages that ship it (cli via tsdown, studio via vite)
```

Per package: `cd packages/<name>` then `bun run test` (watch mode),
`bun run test:run`, `bun run typecheck`.

Day-to-day development has no compile step: package exports point straight at
`src/*.ts`, so vitest, TypeScript, and the dev server all resolve sources with
no extra resolution configuration.

Tooling is configured at the root and expected to stay green: `.oxlintrc.json`
(oxlint, zero findings), `.oxfmtrc.json` (oxfmt — run `bun run format` before
handing work back; `format:check` must pass), `.editorconfig`,
`.gitattributes`. Coverage thresholds are enforced in each package's
`vitest.config.ts` (`test:coverage` fails below them). CI lives at
`.github/workflows/checks.yml`: install (postinstall builds cli + studio) →
lint → format:check → typecheck → test:coverage; publishing is
`.github/workflows/release.yml` (see Releasing). Every gate that runs in CI
runs identically on a laptop — keep it that way.

## Verifying device-visible changes — the static config is the truth

Unit tests prove the plumbing; only the SDK's own config proves a push landed.
Point `SUPERWALL_API_HOST` at the environment under test, publish a scratch
paywall, and read it back the way an SDK does: `GET <that environment's v1 API
host>/api/v1/static_config?pk=<the app's public_api_key>` with
`Authorization: Bearer <pk>`, `X-Platform: iOS`, `X-Platform-Environment: SDK`.
Use `curl` with a `User-Agent`: a bare client with no UA is refused with a 403
at the edge.
Do not verify through `GET /v2/paywalls/:id` — that is the dashboard's view and
omits several stamped columns.

A paywall only appears in `paywall_responses` once a campaign references it, so
a scratch check is: publish → create a campaign with one placement and one
100% treatment variant pointing at the paywall (`superwall post /v2/campaigns
…`) → read the entry → remove the placement (`superwall delete
/v2/campaigns/<id>/placements/<placementId>`), archive the campaign, archive
the paywall. Fields to read: `url`, `products_v2[].store_product`,
`background_color_hex`, `web_checkout_destination`, `presentation_style_v3`,
`feature_gating`, `on_device_cache`, `is_scroll_enabled`,
`game_controller_support`. Never leave a
config key "accepted by the type but inert": it either reaches the device or
it does not exist.

## Testing rules

- Every behavioral change comes with tests. Coverage is expected to stay
  effectively complete — if a branch is unreachable in tests, question the
  branch.
- Runtime fixture tests drive the session through recorded message sequences
  and assert snapshot state — **they are the protocol contract**. Never
  weaken an existing fixture to make a change pass; add new fixtures.
- React hooks are tested with @testing-library/react under jsdom
  (`packages/superwall/test/helpers.tsx` has the harness).
- Protocol schema tests parse representative real messages; when adding a
  message type, add accept AND reject cases.
- Run `bun run test:coverage` before handing work back — thresholds are
  gates, not decoration. `@superwall/protocol`, `@superwall/runtime` and
  `superwall` are at 100% of statements, branches, functions and lines, and
  stay there: an untestable branch is a branch to delete, not a threshold to
  lower. The only files excluded from unit coverage are process-level
  integrations vitest cannot host (vite dev server + browser shell, yargs CLI
  orchestration, the studio app bootstrap), and each is exercised end-to-end
  by the real binaries. Adding an exclusion requires the same: a stated reason
  in the PR description and a real execution path that covers it.
- Code with I/O at its edges is written with an injectable seam so the logic
  is unit-testable (`buildStudioProject`'s config loader, `resolveBinding`
  over the mocked API client) — follow that pattern instead of widening the
  exclusion list.

## Conventions

- ESM only, TypeScript strict everywhere (shared `tsconfig.base.json`).
- No default exports in package source.
- **Naming and layout.** A module is named for what it owns, never for what
  it is: `flow.ts`, `sessions.ts`, `discounts.ts`, `motion.ts` — never
  `services/`, `utils/`, `helpers/`, `constants`, `manager`. camelCase files; PascalCase
  only for React components, `useX` only for hooks. Inside a directory the
  directory's own word is redundant (`checkout/events.ts` exports
  `checkoutEvents` because it is public API, but `checkout/host.ts` exports
  `hostEvents`, not `checkoutHostEvents`). Tests mirror the source tree file
  for file, so `src/checkout/api/decode.ts` is tested by
  `test/checkout/api/decode.test.ts`.
- **Factories over classes.** State with one implementation is a `createX()`
  returning an `X` object type (`createSuperwallSession`,
  `createCheckoutSessions`, `createApplePay`, `createDiscountStore`), which
  keeps private state private and needs no `Reflect` pokes in tests. Classes
  are for a real interface with several implementations — the protocol's
  transports are the only ones in the repo.
- **Type discipline: no assertions.** No `as any`, no `as unknown as`, no
  non-null `!`. Types are derived, and variance is engineered instead of cast
  around: `SuperwallSession` is a covariant (`out`) public interface over a
  base-typed implementation. The only permitted `as` casts are the small set
  of named, documented seams where TypeScript cannot express something real:
  - the custom-product-variables **claim seams** (`createSuperwallSession`,
    `useSuperwallSession`, `requestCallback`) — a caller's declaration about
    SDK-owned data, applied once and derived everywhere else;
  - the **SDK-trust boundaries** (`asProductVariables`, the transport
    no-op `Validator`, `decodeIncomingMessages`' message-like predicate) —
    wire data trusted for forward compatibility. The checkout backend is not
    one of them: its responses are read field by field in
    `checkout/api/decode.ts`;
  - **host-global views** (`window as typeof window & {…}` for
    SDK-injected/published globals).
    A new cast needs a justification of this kind in a comment, or it doesn't
    land.
- `purchase()` never throws for flow outcomes — it resolves
  `{ status: "completed" | "abandoned" | "failed" }`. Keep that contract.
- Product variables are SDK-owned; the runtime merges, never invents.
- Write no comments in new code. Constraints, workarounds and other rationale go
  in the PR description, not beside code they will outlive. Leave existing
  comments alone unless you are changing the code they sit on.
- **Doc comments are for the public surface only, and are all-or-nothing per
  type.** A type a paywall author can name from a `superwall/*` entry (hook
  results, `definePaywall` config, the router, parsers) carries a `/** */` on
  the type _and on every member_ — a half-documented type reads as if the
  undocumented members were obvious, which is never why they were skipped.
  Optional config fields state their default. Everything internal carries
  none: no doc comments on `checkout/flow.ts`, `navigation/animation.ts`, or
  any other module a paywall cannot import — the exception is a lone constant,
  which states what it tunes where it sits (`SESSION_CACHE_TTL`). When in doubt, ask whether it
  appears in the docs site; if it does not, it gets no doc comment.
- New examples and surfaces are added under the maintainer's direction; do
  not scaffold them unprompted.
