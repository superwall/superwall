<p align="center">
  <a href="https://superwall.com/">
    <img src="https://user-images.githubusercontent.com/3296904/158817914-144c66d0-572d-43a4-9d47-d7d0b711c6d7.png" alt="Superwall" height="100" />
  </a>
</p>

<h1 align="center">Superwall CLI</h1>

<p align="center">
  Build paywalls and funnels as code, set up the SDK, manage products and
  campaigns, query your analytics data, and call the API — from your terminal
  or your coding agent.
</p>

## Install

```bash
npm install --global superwall
superwall login
```

Or run it without installing: `npx superwall`. The package installs both the
`superwall` and the short `sw` command. Upgrade any time with
`superwall upgrade` - the CLI also tells you when a new version is out.

`superwall login` opens your browser once and every command shares that
session. In CI, log in without a browser: `superwall login --api-key <key>`.
If your account belongs to more than one organization, pick one with
`superwall orgs use` (you'll otherwise be asked the first time it matters).

## Set up your app

```bash
superwall integrate   # set up Superwall in your app from scratch
superwall migrate     # switch from RevenueCat, Adapty, or Qonversion
superwall review      # audit an existing setup; add --fix to repair issues
superwall doctor      # quick health check
superwall feedback    # tell us what's working and what isn't
```

`integrate` works out what kind of app it's looking at, connects it to your
Superwall account, and runs your own coding agent (Claude Code or Codex,
headless) to install and configure the SDK. Then it walks you through the
rest: products, campaigns, placements, paywalls, and verifying it all on a
real device.

Prefer to drive the agent yourself? Add `--skill` to `integrate`, `migrate`,
or `review` and the CLI prints the full playbook for your project's framework
instead of running it — paste it into any agent.

## Build paywalls & funnels

```bash
superwall create      # start a paywalls project — minimal, or any public example
superwall dev         # open the studio and preview everything live
superwall push        # build and push immutable versions (production untouched)
superwall promote     # point production at a pushed version
superwall publish     # push and promote in one step
```

Every paywall and web funnel is a mini React app: file-based routes, your
components, your design system, plain React state. The `superwall` package is
the framework too — `definePaywall`, the hooks, the typed router, web
checkout — and Superwall takes it from there: products and purchases,
localization, trials, experimentation, and delivery through the native SDKs
(iOS, Android, Flutter, React Native) and the web.

`create` sets up a `superwall/` directory in your app — always that name,
always self-contained. It asks for a starting point (`--example with-rive`
to begin from any example in the
[public repo](https://github.com/superwall/superwall/tree/main/examples)),
then looks at the app around it: if the Superwall SDK is already configured,
it finds your app by its API key and binds pushes to it; otherwise it can log
you in, pick an app, or create one on the spot. `--yes` accepts the defaults;
`--no-install` and `--no-connect` skip those steps, and `--app <id>` connects a
specific Superwall app (the dashboard's **Copy Prompt** passes it) instead of
detecting or asking.

### A project is a directory

```
superwall/
├── package.json              the project's own deps, and the project marker
├── superwall.lock            app + paywall bindings, per platform (commit it)
├── components/               shared design system
├── messages/en.ts            shared strings, inherited by every surface
├── assets/                   shared images, video, and fonts
├── paywalls/
│   └── plus-upgrade/         each paywall is a mini React app
│       ├── config.ts         required — name, products, platforms, settings
│       ├── app/              routes only — every .tsx here is a route
│       │   ├── layout.tsx    optional — wraps every route
│       │   ├── index.tsx     where the flow starts
│       │   ├── plans.tsx     one file per route
│       │   └── goals/        directories prefix route names
│       │       └── setup.tsx "goals/setup"
│       ├── components/
│       └── messages/en.ts
└── funnels/
    └── onboarding/           same shape — onboarding, web2app, win-back
```

Identity is the path: `paywalls/plus-upgrade` **is** the paywall's ID. No name
fields, no registration, no build config — the tooling owns bundling.
`components/`, `messages/`, and `assets/` work at both levels: shared at the
`superwall/` root (`@/…` aliases it), local inside a surface.

### `config.ts`

```ts
import { definePaywall } from "superwall/config";

export default definePaywall({
  name: "Plus — Annual, 3-day trial",
  platforms: ["ios", "android"],
  products: {
    monthly: "pro_999_month",
    annual: { ios: "pro_5999_year", android: "pro_5999_year_play" },
  },
  presentation: { style: "drawer", height: 70 },
  featureGating: "gated",
});
```

`config.ts` is the whole truth for its paywall — there are no project-wide
defaults. `platforms` is a typed array of `ios | android | web`; the project
binds one Superwall app per platform, and a project on several platforms
never guesses which one a paywall means. `products` are slots by reference:
one store identifier, or one per platform when the store product differs —
`purchase("annual")` stays one call, and each platform's build carries only
its own ids. Product data (price, period, trial…) arrives from the SDK at
runtime and is never invented locally. Presentation style, feature gating,
caching, scrolling, game controller, background, and web checkout are all
settings here too: pushed with the version, stamped on promote, and an
omitted key resets to its default. The authoring keys — `name`, `platforms`,
`transition`, `queryState` — are read by the build and the CLI; the runtime
ignores them. Share settings by exporting a plain object and spreading it.

### Hooks

```tsx
import { useProducts, usePurchase, useTranslation } from "superwall/hooks";

export default function PlusUpgrade() {
  const { getProduct } = useProducts();
  const { purchase, isPurchasing } = usePurchase();
  const { t } = useTranslation();
  // your components, your design system — superwall is headless
}
```

One concern each: `useProducts`, `usePurchase` (resolves `completed |
abandoned | failed`, never throws for flow outcomes; with `checkout:
"applePay"` it opens the native Apple Pay sheet and falls back to Stripe's
sheet), `useDiscount` (`await redeem(code)` resolves with the verdict, Stripe's coupon
under Stripe's own field names, and the discounted price per product;
`onDropped` fires if checkout later refuses the code, and a host can redeem one
for the paywall with `redeem_discount`), `useActions` (close, restore, open
URLs and deep links, custom placements, permissions, callbacks, store review,
and `setUserAttributes` — the host SDK persists the attributes and the
paywall's own `useUser()` sees them at once), `useCheckoutRedemption`
(finishes a `postPurchase: "stay"` web checkout — `completed`, `redeem`,
`redirect`), `useHaptics`, `useColorScheme`, `useTranslation`,
`useIntroductoryOffer`, `useDevice` / `useUser` / `useVariables`,
`useLocalResource`, `useSuperwallEvent`, `useGameController`.

Web checkout is made for one shopper: a `user.email` becomes the Stripe
session's `customer_email` (shown in the sheet, not editable there) and a
`user.stripe_customer_id` pins the customer, both read when the session is
created. Setting either later — a funnel capturing the email with
`setUserAttributes({ email })`, or a host sending fresher variables — drops
every cached session and prefetches again, so the sheet never opens with an
empty email once one is known.

Once a purchase completes, `postPurchase` (in `config.ts`, or per
`purchase()` call) decides what happens: `"dismiss"` (the default),
`"stay"` to keep the paywall in control, and on the web `"redeem"` or
`{ redirect: url }`. Pass `stripeMetadata` to `purchase()` to write key/values
onto the Stripe subscription. `checkout: { managedPayments }` and
`introductoryOfferEligibility` round out the config.

### Insets

The paywall is inset from the screen edges by default: the router wraps the
layout and pages in `[data-sw-root]`, padded by
`--sw-inset-top|right|bottom|left`, so nothing a paywall renders starts
under the status bar, cutout or home indicator, and `[data-sw-content]`
inside it is what layout chrome positions against, so `position: absolute;
top: 4px` in a layout is 4px below the bar. `insets` in `config.ts`
picks the padding — `"safe-area"` (default), `"none"`, pixels, a CSS
length, or one value per edge — and the provider writes it inline on
`<html>`. The safe area itself is `--sw-safe-area-inset-*`: the host's
`env(safe-area-inset-*)` where it reports one, else a floor for the device
and presentation the host described (59px above a Dynamic Island, 44px
above a notch, 24px under Android's status bar, 34px over a home
indicator, 0 at the top of a modal or drawer, 0 everywhere on the web).
Fixed chrome on a full-bleed paywall reads those. The provider stamps
`data-sw-platform`, `data-sw-idiom` and `data-sw-cutout` on `<html>` from
the device the host reports, the document carries `data-sw-presentation`
from `config.ts`, and `provider/insets.css` turns those into the floors.
Every framework rule has bare-`:root` specificity and comes first, so a
paywall's own `:root` declaration of any of the three variable layers wins.

### Navigation

```tsx
import { useRouter } from "superwall/navigation";

const router = useRouter();
router.push("goals/setup");
router.push("plans", { transition: "fade" });
router.back();
```

expo-router's API, method for method. Route names are generated into
`superwall.d.ts` on every `dev` and `push`, so a typo is a compile error.
Routes are names, not paths — the whole flow ships as one HTML file — and
`useQueryState` (nuqs's API) keeps web funnel state in the URL so hosted
checkout and in-app browsers hand a flow back where it left off.

### Dev — the studio

`superwall dev` discovers every surface and opens the studio: every paywall
and funnel as a live card, and an editor with a device-frame preview (nine
devices, iPhone SE to Desktop), light/dark, locale switching, and live
controls for the user, device, params, and product variables the SDK
reports. The studio hosts each preview the way the native SDK hosts a
webview: it answers the paywall's `ping` with the SDK's messages, delivers
product data read from Superwall (or the visual editor's example prices for
a slot Superwall has no product for), and asks you for the outcome of every
purchase, restore, permission and callback. The paywall cannot tell the
studio from a device, and the same build runs unchanged inside a real SDK
webview.

### Push, promote, publish

Git semantics on purpose: **push saves, promote ships.** Every push builds
each paywall once per platform, uploads assets by content hash, and mints an
immutable version; nothing users see changes until `promote` repoints
production. `promote --version <n>` makes a rollback one command, `-m "why"`
records a note in the source commit that rides along with every version, and
`--platform <p>` narrows `push`, `promote`, and `publish` to one platform.
Renames are resolved, never guessed — interactively, or with
`push --rename old=new` in CI.

The full reference — assets, localization, trials, transitions, web
checkout, troubleshooting — lives at
[superwall.com/docs/framework](https://superwall.com/docs/framework).

## Manage your account

Everything in the dashboard, from the terminal:

```bash
superwall apps list
superwall products create pro_monthly --price 9.99 --period month
superwall products storekit               # generate a local .storekit file
superwall entitlements create pro
superwall campaigns create "Onboarding upsell" onboarding_complete
superwall campaigns placement <campaign-id> onboarding_complete
superwall paywalls list
superwall whoami
superwall bootstrap                       # the whole account tree at a glance
```

`list` is the default action, so `superwall products` means
`superwall products list`. Add `--json` for machine-readable output, and
`--project <id>` / `--app <id>` to scope when you have more than one. Run
`superwall <command> --help` for every action and flag.

## Query your data

Run SQL directly against your organization's ClickHouse analytics data:

```bash
superwall query "SHOW TABLES FROM sw"
superwall query "SELECT count() FROM sw.<table>"
superwall query --file mrr.sql
cat query.sql | superwall query
```

Use it for anything you'd build on raw data: ad hoc analysis, custom
dashboards, scheduled reports, agent workflows. `--json` returns ClickHouse's
native JSON envelope. Your session needs `data:read` access.

## Call the API

Any Superwall API endpoint, authenticated with your session:

```bash
superwall get /v2/products
superwall post /v2/products -d name="Pro Monthly" -d price:=9.99
superwall delete /v2/products/prod_123
```

`-d key=value` sends a string, `key:=value` sends typed JSON (numbers,
booleans, objects), and `key[sub]=value` nests. On `get` and `delete`, `-d`
params become query parameters.

## App Store Connect

The **entire** App Store Connect API, proxied and signed by Superwall — no
`.p8` file or JWT to manage locally. Connect your credentials once:

```bash
superwall asc keys set --key-id <id> --issuer <id> --key-file AuthKey.p8
```

Then it's the raw ASC API with the sharp edges filed off, because the CLI is
**schema-aware**: it keeps a copy of Apple's own OpenAPI spec (fetched on first
use, refreshed in the background) and knows every endpoint, field, and enum.

Look up the exact schema for anything — no guessing, no hunting through Apple's
docs:

```bash
superwall asc docs                          # browse every resource
superwall asc docs "introductory offer"     # search by keyword
superwall asc docs /v1/subscriptions post   # required fields, enums, relationships
```

Write with flat params. The CLI assembles the JSON:API body for you and
validates it locally, so a mistake comes back as a precise fix instead of one of
Apple's opaque `409`s:

```bash
superwall asc post /v1/subscriptions \
  -d name="Premium Monthly" -d productId=com.acme.pro \
  -d subscriptionPeriod=MONTHLY -d group=<groupId>
```

```
✗ Invalid POST /v1/subscriptions body:
  • subscriptionPeriod "MONTHLY" not allowed — use ONE_WEEK|ONE_MONTH|…|ONE_YEAR
```

Fix the value and it goes through. Shortcuts cover the common reads
(`asc apps`, `asc products <bundle-id>`, `asc subscriptions <bundle-id>`);
everything else is `asc get|post|patch|delete /v1/…`. Between the schema lookup
and the validation, an agent can build and manage your whole ASC catalog —
groups, subscriptions, prices, introductory offers — without ever memorizing the
API or eating a silent rejection.

## For agents and scripts

Pass `--json` to any command: stable output shape, structured errors, never
prompts. `--no-interactive` keeps the human-readable output but drops the
prompts.

Logging in also installs the [Superwall agent skills](https://github.com/superwall/skills)
into your coding agent and keeps them updated. `superwall skills` reinstalls
them (or a subset) manually; `superwall skills -y` installs everything without
asking. The framework itself is built to be written by agents: a plain npm
project, file-based routes, ordinary React state — conventions an agent
already knows, so it gets a paywall right on the first try.

## Telemetry

The CLI sends fully anonymous usage events (which workflow ran and whether it
succeeded — never emails, IDs, file paths, SQL, prompts, or error messages).
Opt out with `SUPERWALL_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1`.

## Package layout

| Entry                  | What it holds                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `superwall`            | `SuperwallProvider` and the runtime types (`SuperwallProduct`, `SuperwallSession`, …) |
| `superwall/config`     | `definePaywall`                                                                       |
| `superwall/hooks`      | every hook, plus `createSuperwall` and `useSuperwallSession`                          |
| `superwall/navigation` | `useRouter`, `useIsFocused`, `useQueryState` + parsers, `PaywallRouter`               |
| `superwall/checkout`   | web checkout (Stripe) — bundled only when `config.checkout` asks for it               |
| `superwall/assets`     | ambient types for asset imports                                                       |

The `superwall` and `sw` binaries launch [`@superwall/cli`](https://github.com/superwall/superwall/tree/main/packages/cli),
which owns every command. `superwall/build`, `superwall/preview`, and
`superwall/discover` are the CLI's tooling contract and `superwall/internal`
belongs to the generated entry — none of them is a public API. That entry
mounts `SuperwallProvider` and nothing else: a snapshot carries no
simulation, and whichever host loads it — a native SDK webview, or a parent
window that opened it with `?transport=editor`, which is what the studio and
the dashboard do — speaks the same protocol to it. The React-free core lives
in [`@superwall/runtime`](https://github.com/superwall/superwall/tree/main/packages/runtime),
the SDK message contract in [`@superwall/protocol`](https://github.com/superwall/superwall/tree/main/packages/protocol),
the host in [`@superwall/host`](https://github.com/superwall/superwall/tree/main/packages/host),
and the studio in [`@superwall/studio`](https://github.com/superwall/superwall/tree/main/packages/studio).

### `superwall/preview`

`startPreviewServer(roots, { port, host?, platformStylesheet?, studio? })`
is what `superwall dev` runs: a vite server that serves the studio at `/`,
each surface at `/preview/<kind>/<id>` as the same document a snapshot is,
the phone-facing `/device` page, and `/device/manifest.json` for the iOS
SDK's dev mode. The studio opens each preview with `?transport=editor` and
hosts it over the SDK protocol. `buildStudioProject(root)` is the payload the
studio loads: surfaces, routes, locales, products and diagnostics.

`studio` is the CLI's side of the studio contract, typed in
`@superwall/studio`: `run(action, surface, onProgress)` for push, promote
and publish, `status(surface)` for the bound paywall, `samples()` for the
dashboard's device, user and product samples, and `appScheme()` for the
"Open in app" button. Without it the studio previews only.

## Develop

This package lives in the [`superwall/superwall`](https://github.com/superwall/superwall)
monorepo. **Read [AGENTS.md](https://github.com/superwall/superwall/blob/main/AGENTS.md)
first** - the conventions in it are decided, not suggested.

```bash
bun install
bun dev               # the studio over every example on http://localhost:6100
bun run test          # every package's test suite
bun run typecheck
bun run lint
```

There is no compile step in day-to-day development — `exports` point straight
at `src/`, so tests, the dev server, and consumers resolve the sources
directly. `bun link` in this directory puts the `superwall` and `sw` commands
on your `PATH`; they run the CLI's built `dist/`, so `bun run build` in
`packages/cli` after every CLI change.

## License

[Functional Source License](https://github.com/superwall/superwall/blob/main/packages/superwall/LICENSE)
(FSL-1.1-ALv2): use it, modify it, embed it, ship it — anything except
building a competing product with it — and every release becomes Apache 2.0
two years after publication. The CLI and the examples are MIT.
