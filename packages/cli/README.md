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

Or run it without installing: `npx superwall`. The CLI ships inside the
`superwall` package (the framework), which installs both the `superwall` and
the short `sw` command. Upgrade any time with
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

`create` sets up a `superwall/` directory in your app — always that name,
always self-contained. `push -m "why"` records a note in the source commit,
and `promote --version <n>` points production at any pushed version, so a
rollback is one command. It asks for a starting point (`--example with-rive` to
begin from any example in the public repo), then looks at the app around it:
if the Superwall SDK is already configured, it finds your app by its API key
and binds pushes to it; otherwise it can log you in, pick an app, or create
one on the spot. `--yes` accepts the defaults; `--no-install` and
`--no-connect` skip those steps.

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
asking.

## Telemetry

The CLI sends fully anonymous usage events (which workflow ran and whether it
succeeded — never emails, IDs, file paths, SQL, prompts, or error messages).
Opt out with `SUPERWALL_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1`.

## Develop

**Read [AGENTS.md](AGENTS.md) first** - command naming, UI rules, skill
authoring, and the sync checklist are decided conventions, not suggestions.

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
