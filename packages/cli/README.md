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
session. Where it can't open one (a server, or over SSH), it says so: open the
URL it prints on any device and approve the code there. In CI, log in without
a browser: `superwall login --api-key <key>`.
There are no organizations to pick: `superwall apps list` shows every app you
can open, grouped by organization, and commands take `--app <id|dashboard link>`.
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
superwall migrate --screen App/UpdateRequiredView.swift   # rebuild a native screen (Swift, Kotlin, RN, Flutter) as a Superwall surface (no path: pick from candidates)
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

### Build

`superwall build` writes the same single-file HTML document a push would
version — `superwall/.superwall/build/<kind>/<id>/[<platform>/]index.html` —
and stops there, no login needed. `--id`, `--platform`, `--out`, `--json`.

### Push, promote, publish

Git semantics on purpose: **push saves, promote ships.** Every push builds
each paywall once per platform, uploads assets by content hash, and mints an
immutable version; nothing users see changes until `promote` repoints
production. `promote --version <n>` makes a rollback one command, `-m "why"`
records a note in the source commit that rides along with every version, and
`--platform <p>` narrows `push`, `promote`, and `publish` to one platform.
Renames are resolved, never guessed — interactively, or with
`push --rename old=new` in CI.

A push also saves the project's source to the app's repo. It applies your
changes on top of whatever teammates have published since your last push
(the commit it last synced to is in `superwall.lock`, so commit it), so two
people working on different paywalls never undo each other. If you both
changed the same file, or the repo has changes this project never synced
with, the push stops and names the files rather than overwriting their work;
`--overwrite-source` replaces the remote source with yours when you mean to.

The full reference — assets, localization, trials, transitions, web
checkout, troubleshooting — lives at
[superwall.com/docs/framework](https://superwall.com/docs/framework).

## Manage your account

Everything in the dashboard, from the terminal. Commands follow the API,
Stripe-style: `superwall <resource> <operation> [ids] [--field value]`.

```bash
superwall apps get <app>                  # everything about one app: bundle ID, Apple team, keys
superwall apps <app>                      # the same: an id where the operation goes means get
superwall apps update <app> --team-id <team-id>
superwall products create --identifier pro_monthly --price 9.99 --period month
superwall products storekit               # generate a local .storekit file
superwall entitlements create --identifier pro
superwall campaigns create --description "Onboarding upsell" --placement onboarding_complete
superwall campaigns placements create <campaign-id> --event-name onboarding_complete
superwall campaigns audiences readout <campaign-id> <audience-id>
superwall users subscriptions <app-user-id> --app <app>
superwall webhooks list --app <app>
superwall bootstrap                       # the whole account tree at a glance
```

Resources: `apps`, `products`, `entitlements` (+ `grants`),
`campaigns` (+ `placements`, `audiences`, `variants`), `paywalls`, `users`,
`webhooks`, `events`. Each has `list`, `get`, `create`, `update`, `delete` where
the API does, plus its own actions (`archive`, `publish`, `duplicate`, ...).

- Every command, and every subcommand of `asc`, `asa`, `setup` and `api`,
  has its own `--help` page with only the flags
  it takes. A group on its own (`superwall asc`) shows that page.
- `superwall <resource> --help` lists its operations;
  `superwall <resource> <operation> --help` lists that operation's flags, read
  from the live API reference, so new API fields work without a CLI update.
- A flag is a request field: `--event-name x` sends `event_name`. Anything else
  goes in with `-d key=value` (`key:=json` for numbers and objects). A flag the
  endpoint doesn't take is refused before anything is sent.
- `--app <id|name|link>` fills in the project, app and organization ids, so
  nobody types `/v2/projects/{id}/applications/{application_id}`.
- `--dry-run` prints the request instead of sending it. Deleting, archiving and
  other changes that can't be undone ask first, and need `--yes` outside a
  terminal.
- Creating takes flags too (`--identifier`, `--name`, `--description`,
  `--placement`), never positionals. One way to change a thing: an app's bundle
  ID and revenue provider are `apps update` fields like any other.
- `list` is the default, so `superwall products` means `superwall products list`.
  `--json` returns the API's response unformatted.

An app's bundle ID (package name on Android) decides which builds the SDK
treats as that app; any other build runs in test mode. `apps get` shows the one
saved and the IDs the app's SDK reported in the last 30 days, each marked live
or test mode. Change it like any other field:

```bash
superwall apps get <app>                             # saved, and what the SDK reported
superwall apps update <app> --bundle-id com.acme.app # save it
```

When builds the SDK reported would run in test mode under the new ID, it says
how many and asks first (`--yes` outside a terminal).

`setup apple` and `asc keys create purchase_key`
keep the In-App Purchase key and the app on one bundle ID. An app with none
gets the Apple app's (or the one `--bundle-id` names) saved with the key, both
or neither, and they say so and how many reported builds would run in test
mode. An app with a different bundle ID stops before anything is created or
saved, and points at `apps update <app> --bundle-id <id>`.

Lists stay usable on big accounts: `--search <text>` matches ids, names and
identifiers, `--limit <n>` caps the rows, and a terminal shows the first 50 with
a count of the rest (`--json` returns everything unless `--limit` caps it).
`bootstrap --app <id>` loads one project instead of the whole account.

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

Many apps receive revenue from both the store and RevenueCat, so the same
purchase can arrive twice, and each app's revenue provider decides which one
its figures count. `--app <app>` passes that to the query as ClickHouse
parameters, so SQL counts revenue the way the dashboard does:

```sql
-- superwall query --file revenue.sql --app <app>
SELECT sum(price)
FROM open_revenue.attributed_events_by_ts_rep FINAL
WHERE applicationId = {app:UInt64}
  AND (integration IN {revenue_integrations:Array(String)} OR source = 'sdk')
  AND NOT (coalesce(integration, '') = 'revenue_cat' AND store = 'STRIPE')
```

`{revenue_provider:String}` holds the provider itself, and `--param name=value`
adds any other parameter.

## Call the API

`superwall api docs` searches the live API reference, so you can find any
endpoint and its exact body before calling it (no login needed):

```bash
superwall api docs variant                    # search by keyword
superwall api docs /v2/campaigns/123/audiences/9/variants post   # one endpoint in full
```

Any Superwall API endpoint, authenticated with your session. A request that
fails names the reference entry to read:

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
`.p8` file or JWT to manage locally. Connect an app in one command:

```bash
superwall setup apple
```

It signs you in to Apple, creates the App Store Connect API key and the In-App
Purchase key the app doesn't have yet, saves them on the app, and points the
app's App Store Server Notifications at Superwall. Your Apple password goes from
your computer straight to Apple; Superwall never receives it and it is not
saved. The Apple Account must be an Admin or the Account Holder. It never
creates a second key of a kind the app already has, never replaces a server
notification URL that another server holds (it reports it and exits non-zero),
and never changes the app's revenue provider.

In a terminal it asks for your Apple Account email, your password (masked) and
the verification code Apple sends. Type `sms` at the code prompt, or pass
`--sms`, to get the code by text. Pass `--team <id|name>` when the account is
on several teams, `--bundle-id <id>` to create the Superwall app from an App
Store Connect app, and `--dry-run` to sign in and check key access without
changing anything.

A coding agent can run it for you if you want it to. You decide that by putting
the password where the agent's shell can read it, as `SUPERWALL_APPLE_PASSWORD`;
never paste it into a chat. Without a prompt the command runs in two steps,
because Apple sends the code after the sign-in starts:

```bash
superwall setup apple --apple-id you@example.com --app <id> --no-interactive   # Apple sends you a code
superwall setup apple --code 123456 --app <id> --no-interactive                # same flags, within 10 minutes
```

The first run exits non-zero saying a code is required; give the agent the code
and it runs the second. Only Apple's pre-verification cookies are kept between
the two runs, in `~/.superwall/apple-sign-in.json`, for 10 minutes.
`--apple-password` exists too, but it lands in shell history and the process
list.

Each step is also its own command, so you or an agent can do one thing at a
time:

```bash
superwall asc keys list --app <id>                    # which of the two keys the app has
superwall asc keys import --app <id>                  # reuse a key your organization already has
superwall asc keys create api_key --app <id>          # sign in to Apple and create just this key
superwall asc keys create purchase_key --app <id>
superwall asc notification-url check --app <id>       # what Apple has, and whose it is
superwall asc notification-url set --app <id>         # set it where Apple has none
```

`asc keys import` saves a key only when Apple confirms it for the app's bundle
ID. `asc keys create` does nothing when the app already has that key; pass
`--replace` to create another. `asc keys sources` lists the keys on your other
apps, `asc keys import <kind> --from <app>` reuses one of them, and
`asc keys delete <kind> --app <id>` removes one from an app. `superwall asc --help` says what
each command changes, what it never does, and its exit codes.

`asc notification-url check` says for production and sandbox whose URL Apple
has: this app's, another Superwall app's (named when you can read that app),
someone else's, or none. `asc notification-url set` never replaces a URL
another server holds. If RevenueCat or your own server receives Apple's
notifications today, keep it there and have it forward them to the URL
`apps get` shows. Both work with a `superwall login` session or
an API key.

Receiving Apple's notifications and choosing which revenue source your
dashboard counts are separate decisions. The second one is the revenue
provider, and `superwall query --app <app>` hands it to your SQL (see Query
your data):

```bash
superwall apps get <app>                                       # what is counted, and how many events each source sent
superwall apps update <app> --revenue-provider open_revenue    # count the store's own events
superwall apps update <app> --revenue-provider revenue_cat     # count RevenueCat's events
```

A change asks first in a terminal and needs `--yes` outside one.

Already have a key file? Save it on an app, or on your organization for the
signed proxy:

```bash
superwall asc keys create api_key --app <id> --key-id <id> --issuer <id> --key-file AuthKey.p8
superwall asc keys create --key-id <id> --issuer <id> --key-file AuthKey.p8
```

Saving an API key on an app also gives the organization a key for that Apple
team when it has none. `asc keys update --team <team id>` replaces the
organization's key for a team, and is refused unless Apple confirms the new key
belongs to the same team.

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

Fix the value and it goes through. Anything the commands below don't cover is
`asc get|post|patch|delete /v1/…`.

### Subscriptions and in-app purchases

What an app sells has its own commands, each with `list`, `get`, `create`,
`update` and `delete`. They take the App Store app as an id or a bundle ID, and
flags named after Apple's own fields:

```bash
superwall asc apps                                          # your apps at Apple
superwall asc products com.acme.app                         # everything the app sells
superwall asc subscription-groups create --asc-app com.acme.app \
  --reference-name Pro --display-name "Acme Pro"
superwall asc subscriptions list com.acme.app
superwall asc subscriptions get <id>                        # localizations, prices, offers, availability, what's missing
superwall asc iaps create --asc-app com.acme.app --product-id coins.100 --name "100 Coins" \
  --in-app-purchase-type consumable --price 0.99 --display-name "100 Coins"
```

`asc subscriptions create` does everything Apple asks for before review, in
order: the subscription, its localization, where it's sold, its price in one
territory equalized to every other, and a free trial if you want one. It ends by
reading the subscription back and saying what's still missing:

```bash
superwall asc subscriptions create --group Pro --asc-app com.acme.app \
  --product-id com.acme.pro.monthly --name "Pro Monthly" --subscription-period ONE_MONTH \
  --price 9.99 --display-name "Pro" --description "Everything, monthly" --trial ONE_WEEK
```

The details have commands of their own:

```bash
superwall asc localizations add --subscription <id> --locale de-DE --name "Pro"
superwall asc prices points --subscription <id> --territory USA --price 9.99
superwall asc prices set --subscription <id> --price 12.99 --preserve-current-price
superwall asc offers create --subscription <id> --offer-mode FREE_TRIAL --duration TWO_WEEKS
superwall asc availability set --iap <id> --available-territories USA,CAN
superwall asc screenshots upload --subscription <id> paywall.png
superwall asc submit --asc-app com.acme.app --group <id> --subscription <id>
```

Every change takes `--dry-run`: it prints each request it would send, bodies
included, and changes nothing. Deletes ask first (`--yes` in scripts).

### Releases

The steps of an App Store release have commands too. A version is its id, or
its version string with `--asc-app` (and `--platform` off iOS):

```bash
superwall asc versions create --asc-app com.acme.app --version-string 1.3.0 --release-type MANUAL
superwall asc builds list com.acme.app --version-string 1.3.0 --processing-state VALID
superwall asc builds attach <build> 1.3.0 --asc-app com.acme.app
superwall asc metadata update 1.3.0 --asc-app com.acme.app --locale en-US --whats-new "Faster sync"
superwall asc release submit 1.3.0 --asc-app com.acme.app --subscription <id>
superwall asc release status 1.3.0 --asc-app com.acme.app      # state, build, review submission, phased release
superwall asc release release 1.3.0 --asc-app com.acme.app     # once it's pending developer release
superwall asc release phased pause 1.3.0 --asc-app com.acme.app
```

`asc release submit` puts the version in the app's review submission, with any
`--subscription`, `--iap` or `--group` alongside: Apple reviews an app's first
in-app purchases only together with a version. `asc versions delete` works only
while a version is still editable; it, `asc builds expire` and `asc release
release` ask first.

`asc get`, `asc post`, `asc patch`, `asc delete` and `asc docs` warn when an
endpoint is one Apple has replaced (the v1 subscription and in-app purchase
localizations, the v1 product submissions, `subscriptionAvailabilities`, the old
in-app purchase and version-submission endpoints, screenshot and preview sets),
and name the replacement.

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

## Upgrading to 2.0

2.0 renamed several commands; the old names are unknown commands now.
[The CLI guide](https://superwall.com/docs/agents/cli#upgrading-from-1x)
maps each one to its replacement.

## Channels

Set `SUPERWALL_CHANNEL=next` to opt into experimental and beta features:
commands that are not in the stable set yet, and the matching agent skills
from the `next` branch of the skills repo. Everything else is unchanged.
Export it in your shell rc so every terminal and agent sees it. Unset it to
go back to the stable set.

## Telemetry

The CLI sends fully anonymous usage events for every command (which command
and subcommand ran, whether it succeeded, how long it took, and flags like
`--json` or `--dry-run` — never emails, IDs, file paths, SQL, prompts, API
paths, or error messages). Events carry a random per-machine id that is never
linked to your account. Opt out with `SUPERWALL_TELEMETRY_DISABLED=1` or
`DO_NOT_TRACK=1`.

## Package layout

```
packages/cli/
├── bin.ts                the entry the `superwall` launcher runs
├── src/
│   ├── entry.ts          main(): run the program, flush telemetry
│   ├── program/          the command system: defineCommand, parser, help, lifecycle
│   ├── commands/         registry.ts + one directory per section of `superwall --help`
│   │   ├── workflows/          integrate, review, migrate
│   │   ├── paywalls/           create, dev, build, push, promote, publish
│   │   ├── main/               bootstrap, apps, products, entitlements, campaigns, paywalls, users, webhooks, events
│   │   ├── analytics/          query
│   │   ├── api/                docs, get, post, patch, delete
│   │   ├── app-store-connect/  setup/, keys/, notification-url/, store/ (apps, products, …), api/ (get, post, …, docs)
│   │   ├── apple-search-ads/   asa (the catalog), keys, api/ (get, post, put, delete, docs)
│   │   ├── account/            login, logout, whoami
│   │   └── support/            doctor, feedback, skills, upgrade
│   ├── core/             the logic behind every command, by domain
│   └── ui/               the renderer: human output, --json envelopes, prompts, help layout
├── dist/skills/          the playbooks integrate/migrate/review run, bundled from superwall/skills at build
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
