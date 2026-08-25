# `superwall`

The framework behind Superwall for Agents: the authoring contract and the
React runtime for paywalls and web funnels written as mini React apps.

```tsx
import { definePaywall } from "superwall/config";
import { useProducts, usePurchase } from "superwall/hooks";
```

| Entry                  | What it holds                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `superwall`            | `SuperwallProvider` and the runtime types (`SuperwallProduct`, `SuperwallSession`, …) |
| `superwall/config`     | `definePaywall`                                                                       |
| `superwall/hooks`      | every hook, plus `createSuperwall` and `useSuperwallSession`                          |
| `superwall/navigation` | `useRouter`, `useIsFocused`, `useQueryState` + parsers, `PaywallRouter`               |
| `superwall/checkout`   | web checkout (Stripe) — bundled only when `config.checkout` asks for it               |
| `superwall/assets`     | ambient types for asset imports                                                       |

`superwall/build`, `superwall/preview`, and `superwall/discover` are the CLI's
tooling contract; `superwall/internal` belongs to the generated entry. Neither
is a public API.

## A paywall is a mini React app

```
superwall/paywalls/plus-upgrade/
├── config.ts            required — name, products
├── app/                 routes only — every .tsx here is a route
│   ├── layout.tsx       optional — wraps every route; the one reserved name
│   ├── styles.css       stylesheets may sit beside their routes
│   ├── index.tsx        "index" — where every flow starts
│   ├── plans.tsx        "plans"
│   └── goals/
│       ├── index.tsx    "goals"
│       └── setup.tsx    "goals/setup"
├── components/          paywall-local components
└── messages/en.ts       paywall-local strings
```

`components/`, `messages/`, and `assets/` work at both levels: at the
`superwall/` root they are shared by every surface (`@/…` aliases that
directory), and inside a surface they are local to it. Funnels
(`superwall/funnels/<id>/`) have exactly the same shape.

## `definePaywall` — `config.ts` (required)

```ts
import { definePaywall } from "superwall/config";

export default definePaywall({
  name: "Plus — Annual, 3-day trial",
  products: {
    monthly: "pro_999_month",
    annual: "pro_5999_year",
  },
});
```

- **`name`** — what the paywall is called on Superwall. Directory names carry
  the restrictions of a URL segment, which makes them poor labels once a
  dashboard holds dozens of them; the directory stays the identifier and this
  is the label. Defaults to the directory name, title-cased.
- **`products`** — slots by reference. Product data (price, period, trial…)
  is SDK-owned and arrives at runtime.
  Product data has no local source and no defaults: `superwall dev` reads it
  from Superwall, and a reference the dashboard has no product for renders
  undefined variables and blocks publishing until it exists.
- **`checkout`** — selling on the web. `"external"` hands off to Superwall's
  hosted checkout page; `"sheet"` takes payment in the paywall in a
  Superwall-rendered sheet; `"applePay"` goes straight to Apple Pay, falling
  back to the sheet where unavailable. The object form
  `{ mode: "sheet", prefetch: "monthly" }` also warms a product's checkout
  session so the sheet opens instantly (`prefetch: false` disables it) —
  `prefetch` is typed against your Stripe product references, so a typo
  fails the build. The gate is build-time: a paywall without `sheet` or
  `applePay` carries zero Stripe code.
- Everything else (`presentation`, `featureGating`, `purchaseTimeoutMs`,
  `notifications`, …) is set here too. There are no project-wide defaults: a
  paywall's `config.ts` is the whole truth for that paywall. Share settings by
  exporting a plain object and spreading it into `definePaywall`.

Messages need no wiring: `messages/<locale>.ts` files are auto-discovered,
shared catalogs layer under local ones, and `t()` resolves against the device
locale.

## Hooks

One concern each — there is deliberately no kitchen-sink hook.

- `useProducts()` — products keyed by reference with SDK-owned `variables`
  (`price`, `period`, `periodly`, `trialPeriodDays`, `currencySymbol`, …).
  `period`/`periodly` localize automatically to the device locale.
- `usePurchase()` — `purchase(ref)` resolving
  `{ status: "completed" | "abandoned" | "failed" }` (never throws for flow
  outcomes); `isPurchasing` and `pendingProduct` pending state built in,
  `transaction`/`failure` for the last outcome, and `prefetch(ref?)` to warm
  a web checkout session before the tap (a no-op for store products).
- `useActions()` — `close`, `restore`, `openUrl`, `openExternalUrl`,
  `openDeepLink`, `customPlacement`, `requestPermission`, …
- `useHaptics()` — `light()`, `medium()`, `heavy()`, `success()`, `warning()`,
  `error()`, `selection()`
- `useColorScheme()` — `"light" | "dark"`, as the SDK reports it.
- `useTranslation()` — `t(key, values)` with `{placeholder}` interpolation,
  device-locale detection, `setLocale` override.
- `useTrialEligibility()` — the SDK's real intro-offer eligibility signal.
- `useDevice()` / `useUser()` / `useVariables()` — what the SDK knows about
  this presentation. `useVariables()` returns `{ device, user, params }`;
  `params` stays `Record<string, unknown>` because its shape is decided by the
  app at the call site.
- `useSuperwallEvent(name, handler)` — typed protocol events.
- `useGameController(handler)` — the SDK's game-controller events.
- Escape hatches: `useSuperwallSnapshot()`, `useSuperwallSession()`.
- `createSuperwall<TCustomVariables>()` — a typed bundle when paywalls declare
  custom product variables.

## `superwall/navigation`

`app/` holds routes and nothing else — every `.tsx` in it is a route, a
directory prefixes the name, and `index.tsx` is the directory's own route. The
only reserved name is `layout.tsx`, and stylesheets may sit beside their routes.
Components and hooks live in `components/`; anything else in `app/` is a
diagnostic — a warning on `dev`, a hard failure on `push`, since a published
version is immutable. A route is a file that is lowercase-kebab **and**
default-exports a component, so a component can never become an accidental
route.

```tsx
import { useRouter } from "superwall/navigation";

const router = useRouter();

router.push("goals/setup");
router.push("plans", { transition: "fade" });
router.replace("terms");
router.back();               router.canGoBack();
router.dismiss(2);           router.dismissAll();
router.dismissTo("goals");

router.name;  router.depth;
```

The API is expo-router's, method for method, so Expo knowledge transfers
directly. Closing the paywall is not navigation — that is
`useActions().close()`.

Route names are **type-safe**: the CLI generates `superwall.d.ts` from your
`app/` directories on every `dev` and `push`, so a typo is a compile error and
editors autocomplete the real list. The same file declares the asset modules
that make `import hero from "./assets/hero.jpg"` typecheck. Commit it, don't
edit it, and don't delete it — without it both stop working.

Routes are names, not paths — an SDK webview has no URL bar, and the whole flow
ships as one HTML file, so navigation never touches the network. Routes below
the top stay mounted, so popping back restores one exactly as it was left, and
they are `inert` so nothing underneath can be focused; `useIsFocused()` lets a
backgrounded route pause work. Every navigation reports `page_view`.

`app/layout.tsx` is an ordinary component that receives the router's output as
`children`. It is optional, and it stays mounted for the life of the flow —
which makes it the right home for shared chrome and, via plain React context,
for state shared across routes.

```tsx
export default function Layout({ children }: PropsWithChildren) {
  return <div className="shell"><Header />{children}</div>;
}
```

Transitions are `push` (the default), `slide`, `fade`, `shift`, and `none`.
`push` is the iOS navigation push: in from the right with an edge shadow while
the route behind drifts left and dims, clamped to 300px of travel, reversed on
the way back. `slide` moves both routes as one, flat. `fade` runs shorter
(350ms) on a plain ease — opacity has no momentum — and fades only one layer at
a time, since two half-faded layers composite to less than full opacity.
`shift` is the funnel step: the arriving route fades in as it drifts the last
44px into place (420ms, from the left on the way back) and the route it
replaces is simply gone — one layer moves at a time, so a twenty-step flow
never reads as a stack. Resolution runs call site → the route's own export →
the surface default in `config.ts` → `push`.

```ts
export default definePaywall({ transition: "slide" });   // whole surface
```

```tsx
export const transition = "fade";                        // one route
router.push("terms", { transition: "none" });            // one navigation
```

The transition belongs to the navigation rather than to a route — forward uses
the incoming route's, back uses the leaving one's, so a route always leaves the
way it arrived. Motion runs over 500ms on a curve whose speed
starts at zero and peaks at 60ms, so pages ease into their travel: 49.7% of the
distance by 100ms, 84.7% by 200ms, 96.2% by 300ms. No overshoot.
`cubic-bezier(0.28, 0.4, 0.08, 1)` is the fallback.

| variable                | default  |                                                                  |
| ----------------------- | -------- | ---------------------------------------------------------------- |
| `--sw-transition`       | `500ms`  | duration                                                         |
| `--sw-ease`             | spring   | timing function                                                  |
| `--sw-transition-fade`  | `350ms`  | duration for `fade`                                              |
| `--sw-ease-fade`        | ease     | timing function for `fade`                                       |
| `--sw-transition-shift` | `420ms`  | duration for `shift`                                             |
| `--sw-ease-shift`       | ease     | timing function for `shift`                                      |
| `--sw-stack-dim`        | `0.925`  | brightness of the route behind                                   |
| `--sw-background`       | `Canvas` | route background — routes are opaque so nothing shows through    |
| `--sw-routes-height`    | `100dvh` | route height; set it when a layout puts chrome around the routes |

All motion is disabled under `prefers-reduced-motion`.

### Writing your own

`transition` accepts any name — the router just stamps it onto
`data-sw-transition` and tells each route which part of the movement it is
playing via `data-sw-phase`. There is nothing to register.

| phase    | the route is…                       |
| -------- | ----------------------------------- |
| `enter`  | arriving on top                     |
| `recede` | being covered as you go forward     |
| `leave`  | dropping off the top as you go back |
| `return` | coming forward again as you go back |

The attribute is absent whenever a route is idle, so a rule can never leak
outside its transition. Name the phases you want; the ones you leave out simply
do not animate — which is how `fade` avoids animating both layers at once.

```css
@media (prefers-reduced-motion: no-preference) {
  [data-sw-transition="zoom"][data-sw-phase] {
    animation-duration: 420ms;
    animation-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  [data-sw-transition="zoom"][data-sw-phase="enter"]  { animation-name: zoom-enter }
  [data-sw-transition="zoom"][data-sw-phase="recede"] { animation-name: zoom-recede }
  [data-sw-transition="zoom"][data-sw-phase="leave"]  { animation-name: zoom-leave }
  [data-sw-transition="zoom"][data-sw-phase="return"] { animation-name: zoom-return }
}

/* the arriving page comes up from behind, the covered one grows past and fades */
@keyframes zoom-enter  { from { opacity: 0; transform: scale(0.85) } }
@keyframes zoom-recede { to   { opacity: 0; transform: scale(1.15) } }
@keyframes zoom-leave  { to   { opacity: 0; transform: scale(0.85) } }
@keyframes zoom-return { from { opacity: 0; transform: scale(1.15) } }
```

```ts
export default definePaywall({ transition: "zoom" });   // or per route, or per call
```

Two things worth knowing:

- **Duration is measured from your CSS**, so a route stays mounted exactly as
  long as its animation runs. Nothing declares a duration twice, and a five
  second cap means a runaway animation cannot strand the stack.
- **Wrap motion in `prefers-reduced-motion`** as above. With reduced motion on,
  the router settles immediately rather than waiting.

`examples/transitions` defines `zoom` this way in `app/theme.css`, and
`data-sw-state` (`active`/`behind`/`exiting`/`below`) and `data-sw-direction`
remain on each route if you need to key on something the four phases do not
name.

### State in the URL

Routes carry no params, and state between them is plain React. For a flow on
the web that is not enough: an in-app browser hands a link — only the link — to
the OS browser, hosted checkout returns to a URL, and a reload starts over. So
a surface with `checkout` keeps its state in the page URL:

- the route stack, as `?sw_nav=index,goal,plan` — `push` adds a browser history
  entry, everything else rewrites in place, and the browser's back button is
  `router.back()`. Any URL rebuilds the stack it names (unknown routes start
  over at `index`), with no animation and one `entry` page view.
- whatever a page asks to keep, with `useQueryState` — nuqs's API, so the
  parsers read the same:

```tsx
import { parseAsStringEnum, parseAsInteger, useQueryState } from "superwall/navigation";

const [goal, setGoal] = useQueryState("goal", parseAsStringEnum(["focus", "habit"]));
const [step, setStep] = useQueryState("step", parseAsInteger.withDefault(1));
const [name, setName] = useQueryState("name");               // string | null

setGoal("focus");                                            // ?goal=focus
setStep((current) => current + 1);
setGoal(null);                                               // key removed
setGoal("habit", { history: "push" });                       // a history entry
```

`parseAsString`, `parseAsInteger`, `parseAsFloat`, `parseAsBoolean`,
`parseAsStringEnum(values)`, `parseAsArrayOf(parser, separator?)`, and
`createParser({ parse, serialize, eq? })`. `.withDefault(value)` removes
`null` from the type and, by default, clears the key when the value equals the
default (`clearOnDefault: false` keeps it). `.withOptions({ history,
clearOnDefault })` bakes options into a parser; the setter's second argument
overrides them per call. A value the URL holds that fails to parse reads as
the default.

Nothing is persisted unless a page asks — the framework never decides what an
answer is — and `sw_*`, `platform` and `transport` are reserved (the hook
throws). Writes are coalesced
(replaces settle 300ms after the last one; a push lands at once) so a text
input cannot trip Safari's history rate limit, and anything pending is flushed
before the page is hidden. Foreign params (`utm_*`, the studio's overrides)
are left alone.

The same hook on a native host — which has no URL bar — is plain state shared
across routes, so a paywall reads identically everywhere. `definePaywall({
queryState: true | false })` overrides the `checkout` default either way.
Mind the URL budget: about 2 kB is safe across every app and share sheet, so
keep keys short and values enumerable, and keep anything personal out of it.

## Dev — the studio

`superwall dev` discovers every surface and hosts the **studio**
(`@superwall/studio`): `/` shows every paywall and funnel as a card with a
live miniature; `/paywall/<id>` opens the editor — a device-frame preview at
exact logical size with hardware switching (nine devices, iPhone SE to iPad
Pro to Pixel to Desktop; each switch also flips the mock SDK's
platform/model/OS), light/dark simulation, locale switching, and live
variable controls for the User, Device, Params and Products groups the SDK
reports. The studio ships, too: Push, Publish and Promote run from its
toolbar, with a Compare view that diffs the preview against what's live.

Bare mounts live at `/preview/<kind>/<id>` — what the studio's iframes load —
against the **mock SDK host**: purchases resolve, trials start, and
permissions answer like a real device, while product data is supplied by the
dev server from Superwall — the mock invents none of it. Inside a real SDK
webview the mock detects the native host and disengages — the same build
runs everywhere. Preview overrides travel as query params — `theme`,
`locale`, `sw_device`, `sw_user`, `sw_params`, `sw_products`, `sw_trial` —
the same channel published snapshots accept.

## Push / promote lifecycle

```sh
superwall push               # bind → build → assets → version. Production untouched.
superwall promote            # point production at a pushed version (latest by default)
superwall promote --id plus-upgrade --version 6
superwall publish            # push + promote in one step — ship it now
superwall publish -m "Q3 pricing test"   # record why, in the source commit
```

Git semantics on purpose: **push saves, promote ships.** Every push mints a
sealed version; nothing users see changes until promote repoints production
(and stamps the URL delivered to SDKs). Pushing identical content returns
the existing version — an idempotent no-op.

Binding — push updates, never duplicates, and needs no IDs in your code.
`superwall.lock` is the binding of record.
Resolution order: `superwall.lock` (written on first push, commit it) → a
dashboard paywall already stamped with this surface
(`metadata.headlessSurface`) or whose identifier matches the directory name →
auto-create. The app resolves automatically too: `superwall.lock` → your
account (a single app binds itself; several prompt once, and the answer is
saved to the lock). Nothing about the dashboard belongs in your config —
`superwall.lock` holds every binding, and it is meant to be committed.
Snapshots are content-addressed (sha256), so every change is a new immutable
version.

Renaming a directory is **resolved, never guessed**. Before anything is pushed,
push pairs up bound ids whose directory is gone with directories that have no
binding, and asks about each one:

```
? `pro-upgrade` is not in superwall.lock. Is it a new paywall, or renamed?
  › Renamed from plus-upgrade   paywall 208540
    Create a new paywall
```

Picking a rename moves the binding — the new directory keeps the live paywall —
and that candidate is removed from the list, so several renames in one commit
resolve correctly one after another.

The paywall keeps its original name on Superwall, which is cosmetic: every push
stamps the surface it came from, so the paywall re-identifies itself with the new
directory name and a lost `superwall.lock` still rebinds correctly. Rename it in
the dashboard if you want the names to match.

A binding nobody claims — you chose "Create a new paywall", or the directory is
simply gone — is offered for removal:

```
? `pro-upgrade` is bound to paywall 208540 but no longer exists on disk.
  Removing only forgets it locally — paywall 208540 stays on Superwall, keeps
  its campaigns, and keeps serving devices.
  › Remove the binding   restoring the directory re-binds it on the next push
    Keep it              superwall.lock is left as it is
```

Removing edits `superwall.lock` and nothing else. It is recoverable: push stamps
the surface a paywall came from, so restoring the directory re-binds it to the
same paywall on the next push.

CI never guesses and never prompts. Declare renames instead, and anything left
unresolved stops the push rather than creating a second paywall:

```sh
superwall push --rename plus-upgrade=pro-upgrade
```

`--rename` is repeatable, and it is the only way to resolve a rename without a
prompt. If a paywall really is gone, remove its entry from `superwall.lock` by
hand — the lock is the binding of record, and editing it never touches
Superwall.

Deleting a surface is not a rename: a binding with no directory and nothing new
beside it never blocks a push. Non-interactive runs never touch the lock without
consent — they keep the binding and print one notice.

There is deliberately **no `identifier` field in `config.ts`**. Identity stays
the path: a user-editable id would move this same fork risk somewhere harder to
see, and two copied directories could claim one paywall.

Source — every push and publish also commits your `superwall/` directory
alongside the version, so the dashboard can show and diff the code a snapshot
was built from. The CLI pushes it **straight into your app's source repo over
git**: a normal commit of your files exactly as they are on disk, and nothing
else — the per-publish facts (version, snapshot, framework, portability) ride
the commit's trailers, so identical sources always hash to an identical tree
and a repeat push dedupes. `package.json` and your lockfile go with it, which
is what makes a clone installable. Nothing is summarized, substituted or
capped — a repo full of video is fine, though anything over 50 MB earns a
warning, since every future clone pays for it.

Portability — an import that resolves outside the project directory builds
fine locally but cannot be rebuilt from the commit, so the push warns once,
naming each offender, and records `Superwall-Portable: false`. The dashboard
greys out remote editing with a reason instead of failing. Keep every import
inside the project or coming from a package in `package.json` and the push
records `Superwall-Portable: true`.

`git` is required (`superwall publish requires git for the source step`). The
write token is repo-scoped, lives for minutes, and is revoked the moment the
commit is linked; it travels in git's environment, never in a remote URL or a
command line.

`-m "why"` records a publish note in the commit body. It only lands when the
publish actually creates a commit — republishing unchanged source reuses the
existing one and reports `Source unchanged`.

Every version has its sources: the step is blocking and there is no opt-out,
and a rejected source push fails the surface before promote runs.
`.superwall/`, `node_modules/`, `.git/`, `.env*`, `.DS_Store` and anything
your `superwall/.gitignore` lists never leave the machine.

## Assets

A snapshot is one file, but not everything belongs inside it. Anything you
import — `import hero from "@/assets/hero.jpg"` — under 32 kB is inlined as a
data URI; anything larger, **and every video at any size**, is uploaded once
and referenced by absolute URL:

```
superwall/paywalls/plus-upgrade/assets/promo.mp4
  → https://user-content.superwalleditor.com/user-content/hl/<app>/<sha256>.mp4
```

The shell stays self-contained (all JS and CSS inline, no remote code, ever),
while imagery and video are served from a CDN that speaks Range requests — so
video streams, which a data URI can never do. That is also why a video is
never inlined however small it is: a data URI has no Range to serve.

Pretty much any asset type works: images (`png` `jpg` `webp` `avif` `gif`
`svg` `ico`), video (`mp4` `webm` `mov` `m4v`), audio (`mp3` `m4a` `aac`
`wav` `ogg`), fonts (`woff2` `woff` `ttf` `otf`), and player payloads —
`lottie`, `riv`, `glb`. Anything else under `assets/` is hosted as opaque
bytes rather than rejected. Video, audio and player payloads are never
inlined at any size: something fetches them by URL at runtime, so a data URI
only costs a second copy.

**Lottie has two shapes, and they behave differently.** Import the animation
JSON directly (`import data from "@/assets/spin.json"`) and it is bundled
into the snapshot — offline-proof, no request, best for small animations.
Ship a `.lottie` (or a `.riv`) and it is hosted like any other asset, fetched
by the player at runtime and pre-cached through the SDK's resource manifest
along with everything else the paywall needs.

**Anything hosted has to live in an `assets/` directory** — `superwall/assets/`
for files every surface shares, `superwall/paywalls/<id>/assets/` for one
surface's own. The build fails and names the file otherwise, so a repo never
drifts into shipping imagery from wherever it happened to land. Small assets
are exempt (they inline, and never leave the machine), as is anything a
package in `node_modules` ships.

Assets are content-addressed:
identical bytes upload once per app, across every paywall and every push, and
`superwall push` reports `Assets up to date` when there is nothing new. The
URL is baked in at build time, which is why the push binds the paywall before
it builds.

Multi-page flows prefetch: the build records which route needs which asset
and the router warms the next page's imagery while you are still looking at
the current one, using `new Image()` and `<link rel=preload>` — never `fetch`
or `rel=prefetch`, which the serve-time CSP blocks. Only types the browser
can preload meaningfully (images, video, audio, fonts) are warmed this way;
a `.lottie` or `.riv` still ships in the SDK manifest, so it is pre-cached
before the paywall opens, just not by the router.

## The platform layer (two-layer contract)

A snapshot is immutable, but it isn't alone. The build stamps **document
semantics** as data attributes on `<html>` — `data-sw-generation="5"`,
`data-sw-scroll="false"`, … — evaluated from the merged config
(`documentAttributes` in `@superwall/runtime`). At serve time the platform's
runtime worker injects **live.css**, a Superwall-owned stylesheet whose rules
decide what those attributes mean (`html[data-sw-scroll="false"] body {
overflow: hidden }`). The snapshot declares _what it is_; the platform decides
_what that means today_ — so platform-wide style fixes ship to every
published paywall without anyone republishing.

**Local previews are the same document, served the same way.** `src/document.ts`
renders the HTML for both the build and the preview server, and the preview
server applies the identical live.css injection the runtime worker performs —
so a paywall on your laptop carries the same `data-sw-*` semantics, under the
same platform stylesheet, as the one Superwall serves. The single deliberate
difference is the webview simulation (`src/preview/webview.ts`): scrollbar
behavior a desktop browser gets wrong and a device does not — the visual
counterpart to the mock SDK host. Previews use the production live.css by
default; `SUPERWALL_RUNTIME_URL` in the project `.env` points them at a local
runtime instead.

Machinery exports for tooling: `superwall/preview` (`startPreviewServer`),
`superwall/build` (`buildSnapshot`), and `superwall/discover`
(`discoverProject`). The CLI (`@superwall/cli`) owns every command — dev,
push, promote, publish live there — and loads this machinery dynamically
from the project's own install, so commands always run against the framework
version in the project's lockfile.
