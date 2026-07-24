# `superwall`

The paywall framework. One root import for everything: the authoring contract
and the React runtime. File-based navigation lives in `superwall/navigation`.

```tsx
import { definePaywall, useProducts, usePurchase, v } from "superwall";
```

## A paywall is a mini React app

```
superwall/paywalls/plus-upgrade/
├── config.ts            the contract: products, variables, preview
├── app/
│   ├── page.tsx         "/" — file-based routing, Next.js-style
│   ├── offer/page.tsx   "/offer"
│   └── layout.tsx       optional chrome around every page
├── components/          paywall-local components
└── messages/en.ts       paywall-local strings
```

Shared `components/`, `messages/`, and `assets/` live one level up in the
`superwall/` directory and are inherited by every surface (`@/…` aliases it).
Funnels (`superwall/funnels/<id>/`) have exactly the same shape.

## `definePaywall` — `config.ts`

```ts
import { definePaywall, v } from "superwall";

export default definePaywall({
  products: {
    go: "chatgpt_go_499_month",
    plus: "chatgpt_plus_1999_month",
  },
  variables: {
    defaultPlan: v.enum(["go", "plus"], { default: "plus" }),
    showWebCheckout: v.boolean({ default: true }),
  },
  preview: {
    products: [{ reference: "plus", product: "plus", variables: { price: "$19.99" } }],
    purchaseOutcome: "abandoned",
  },
});
```

- **`products`** — slots by reference. Product data (price, period, trial…)
  is SDK-owned and arrives at runtime.
- **`variables`** — experiment knobs, read with `resolveVariables(config.variables)`.
  The schema is serialized on push; the dashboard renders controls from it, so
  a variant becomes `{ snapshot, overrides }` — no code change, no rebuild.
- **`preview`** — mock-host overrides (real prices, purchase outcomes,
  device variables, trial eligibility). They ship inside the snapshot but
  only engage where no real SDK host exists — inside a webview the native
  host always wins.
- Everything else (`presentation`, `featureGating`, `purchaseTimeoutMs`,
  `notifications`, …) merges over the app-level `defaults` from
  `superwall/config.ts` (`defineConfig`).

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
  outcomes); `isPurchasing` pending state built in.
- `useActions()` — `close`, `restore`, `openUrl`, `openExternalUrl`,
  `openDeepLink`, `customPlacement`, `requestPermission`, `hapticFeedback`, …
- `useTranslation()` — `t(key, values)` with `{placeholder}` interpolation,
  device-locale detection, `setLocale` override.
- `useTrialEligibility()` — the SDK's real intro-offer eligibility signal.
- `useDevice()` / `useUser()` / `useVariables()` — SDK variable groups
  (`useVariables()` also carries the placement `params`).
- `useSuperwallEvent(name, handler)` — typed protocol events.
- Escape hatches: `useSuperwallSnapshot()`, `useSuperwallSession()`.
- `createSuperwall<TCustomVariables>()` — a typed bundle when paywalls declare
  custom product variables.

## `superwall/navigation`

```tsx
import { Link, useRouter } from "superwall/navigation";

const { push, back, path } = useRouter();
```

Pages navigate in memory (an SDK webview has no URL bar) with a history stack
for `back()`. The framework mounts pages; `PaywallRouter` is its internal
mounting primitive.

## Dev — the studio

`superwall dev` discovers every surface and hosts the **studio**
(`@superwall/studio`): `/` shows every paywall and funnel as a card with a
live miniature; `/paywall/<id>` opens the editor — a device-frame preview at
exact logical size with hardware switching (iPhone SE → iPad Pro → Pixel;
each switch also flips the mock SDK's platform/model/OS), light/dark
simulation, locale switching, and live experiment-variable controls rendered
from the surface's `v.*` schema.

Bare mounts live at `/preview/<kind>/<id>` — what the studio's iframes load —
against the **mock SDK host**: products, purchases, trials, and permissions
behave like a real device; inside a real SDK webview the mock detects the
native host and disengages — the same build runs everywhere. Preview
overrides travel as query params (`theme`, `locale`, `sw_device`, and
`sw_vars` for experiment variables — the same channel the dashboard uses to
apply variant overrides to published snapshots).

## Push / promote lifecycle

```sh
superwall push               # build → bind → immutable version. Production untouched.
superwall promote            # point production at a pushed version (latest by default)
superwall promote --only plus-upgrade --version 6
superwall publish            # push + promote in one step — ship it now
```

Git semantics on purpose: **push saves, promote ships.** Every push mints a
sealed version; nothing users see changes until promote repoints production
(and stamps the URL delivered to SDKs). Pushing identical content returns
the existing version — an idempotent no-op.

Binding — push updates, never duplicates, and needs no IDs in your code.
Resolution order: `superwall.lock` (written on first push, commit it) → a
dashboard paywall already stamped with this surface
(`metadata.headlessSurface`) or whose identifier matches the directory name →
auto-create. The app resolves automatically too: `superwall.lock` → your
account (a single app binds itself; several prompt once, and the answer is
saved to the lock). Nothing about the dashboard belongs in your config —
`superwall.lock` holds every binding, and it is meant to be committed.
Snapshots are content-addressed (sha256), so every change is a new immutable
version.

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
`superwall/build` (`buildSurface`), and `superwall/discover`
(`discoverProject`). The CLI (`@superwall/cli`) owns every command — dev,
push, promote, publish live there — and loads this machinery dynamically
from the project's own install, so commands always run against the framework
version in the project's lockfile.
