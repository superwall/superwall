<p align="center">
  <a href="https://superwall.com/">
    <img src="https://user-images.githubusercontent.com/3296904/158817914-144c66d0-572d-43a4-9d47-d7d0b711c6d7.png" alt="Superwall" height="100" />
  </a>
</p>

<h1 align="center">@superwall/cli</h1>

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

This package is the engine behind the `superwall` command — every command
lives here — and the [`superwall`](https://www.npmjs.com/package/superwall)
package installs it for you, along with the framework and both the
`superwall` and the short `sw` binaries. Install `superwall`, not this
package; everything below is what you get.

`superwall login` opens your browser once and every command shares that
session. In CI, log in without a browser: `superwall login --api-key <key>`.
If your account belongs to more than one organization, pick one with
`superwall orgs use` (you'll otherwise be asked the first time it matters).
Upgrade any time with `superwall upgrade` - the CLI also tells you when a new
version is out.

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
superwall create --from {ID}   # rebuild a dashboard paywall as code: its config.ts, a migration brief, Compare › Original in the studio
superwall migrate {ID}         # …then rebuild its pages with your coding agent, or copy the prompt (--skill prints it)
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
caching, scrolling, game controller, introductory-offer eligibility,
background, and web checkout are all settings here too: pushed with the
version, stamped on promote, and an omitted key resets to its default. Share
settings by exporting a plain object and spreading it.

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
abandoned | failed`, never throws for flow outcomes), `useActions`,
`useHaptics`, `useColorScheme`, `useTranslation`, `useIntroductoryOffer`,
`useDevice` / `useUser` / `useVariables`, `useLocalResource`,
`useSuperwallEvent`, `useGameController`.

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
webview: it answers the paywall's `ping` over the SDK protocol with products,
device, user and eligibility, and asks you for every purchase, restore,
permission and callback outcome. Product data is read from Superwall, never
invented, and the same build runs unchanged inside a real SDK webview.

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

## Apple Search Ads

The **entire** Apple Ads Campaign Management API (v5), proxied by Superwall —
no client secret, OAuth token, or org id to manage locally. It uses the
credentials you connect in the dashboard (app → Integrations → Apple Search
Ads → Advanced); the CLI finds the connected app on its own, or takes
`--app <id>`.

```bash
superwall asa campaigns list
superwall asa campaigns find --field status --op EQUALS --values ENABLED --all
superwall asa keywords create --campaign 123 --adgroup 456 \
  --text "grammar checker" --match-type EXACT --bid 1.25
superwall asa reports campaigns --start 2025-01-01 --end 2025-01-31 --group-by countryOrRegion
```

Every resource follows the same shape — `asa <resource> <action> [id]`, scoped
with `--campaign` / `--adgroup` / `--adam-id` — and the catalog is the
documentation:

```bash
superwall asa docs                          # every endpoint, grouped
superwall asa docs keywords                 # one resource: usage, flags, Apple links
superwall asa docs campaigns create         # Apple's own page: fields, enums, examples
```

Writes take typed flags (money flags pick up the account's currency),
`-d key=value` for any other field, or `--body` for the whole payload. Anything
not covered is `asa get|post|put|delete /path`, sent straight to Apple with
your access token and org context attached.

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

```
packages/cli/
├── bin.ts                the entry the `superwall` launcher runs
├── src/
│   ├── cli.ts            every command, flag, and help line (yargs)
│   ├── commands/
│   │   ├── account/      login, whoami, orgs, doctor, feedback, skills, upgrade
│   │   ├── resource/     apps, products, entitlements, campaigns, paywalls, bootstrap
│   │   ├── workflow/     integrate, migrate, review
│   │   ├── platform/     get/post/patch/delete, query, asc, asc keys
│   │   └── paywalls/     create, dev, push, promote, publish
│   ├── core/             api client, auth, project detection, paywall
│   │                     binding + lock, agent runners, telemetry, skills sync
│   └── ui/               the renderer: human output, --json envelopes, prompts
├── skills/               the bundled playbooks integrate/migrate/review run
└── tests/                mirrors src/
```

The paywall commands load the framework's tooling contract
(`superwall/build`, `superwall/preview`, `superwall/discover`) dynamically
from the project's own install, so they always run against the framework
version in the project's lockfile.

## Develop

This package lives in the [`superwall/superwall`](https://github.com/superwall/superwall)
monorepo. **Read [AGENTS.md](https://github.com/superwall/superwall/blob/main/AGENTS.md)
first** - command naming, UI rules, skill authoring, and the sync checklist
are decided conventions, not suggestions.

```bash
bun install
bun dev               # run from source (bun bin.ts)
bun run build         # build dist/ with tsdown
bun run typecheck
bun run test
```

The global `superwall`/`sw` binaries are declared by the framework package:
`cd ../superwall && bun link` links them. They run this package's built
`dist/`, so rebuild after every change.

## License

[MIT](https://github.com/superwall/superwall/blob/main/packages/cli/LICENSE).
The framework it launches is licensed under the
[Functional Source License](https://github.com/superwall/superwall/blob/main/packages/superwall/LICENSE)
(FSL-1.1-ALv2).
