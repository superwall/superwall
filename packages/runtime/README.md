<p align="center">
  <a href="https://superwall.com/">
    <img src="https://user-images.githubusercontent.com/3296904/158817914-144c66d0-572d-43a4-9d47-d7d0b711c6d7.png" alt="Superwall" height="100" />
  </a>
</p>

<h1 align="center">@superwall/runtime</h1>

<p align="center">
  The framework-agnostic runtime core behind every Superwall paywall: SDK
  messaging, product state, localization, and purchases — no React.
</p>

## Install

```bash
npm install @superwall/runtime
```

You will not usually install this directly: the
[`superwall`](https://www.npmjs.com/package/superwall) framework depends on
it and exposes everything here through its hooks. Reach for it alone when a
paywall is not React, or when a host (the studio, the dashboard, a test
harness) needs the session model without a UI.

## What's here

This package is the runtime boundary shared by every paywall Superwall
serves — built with this framework or with the visual editor. It owns
transport selection, message logging, base64 message ingestion, product
state, localization, SDK action dispatch, and purchase promise resolution.
It must not import React, or anything above it in the stack.

- **`SuperwallBridge`** — transport auto-detection (WebKit / Android / editor
  iframe), message log, `accept` / `accept64` ingestion, `postMessage`.
- **`SuperwallSession`** — the runtime model on top of the bridge:
  - product state merged from `products` + `template_variables`
  - `device` / `user` / `params` variables, `experiment` assignment
  - trial eligibility from `template_substitutions_prefix` ("freeTrial")
  - locale resolution + `t()` translation from the config's message catalogs
  - promise-based `purchase()` with timeout, resolved by transaction messages
  - auto-scheduled trial reminder notifications on `freeTrial_start`
  - typed events: `session.on("paywall_open", …)`, `"message"` for all
- **`MockSuperwallTransport`** — a simulated native SDK host for local dev,
  dashboard previews, tests, and the build-time conformance harness.

## Usage

```ts
import { createSuperwallSession, defineSuperwallConfig } from "@superwall/runtime"

const config = defineSuperwallConfig({
  products: { primary: "pro_3999_year" },
  purchaseTimeoutMs: 5 * 60 * 1000,
  notifications: {
    trialReminder: { title: "notifications.trialTitle", body: "…", beforeTrialEndDays: 1 },
  },
  localization: { defaultLocale: "en", messages: { en: { notifications: { trialTitle: "…" } } } },
})

const superwall = createSuperwallSession({ config })
superwall.start({ sendPing: true })

const { products, device, trial, locale } = superwall.getSnapshot()
superwall.t("paywall.title")

const result = await superwall.purchase("primary")
// result.status: "completed" | "abandoned" | "failed" — never throws for flow outcomes

superwall.on("transaction_complete", (message) => {})
```

### Purchase semantics

- `{ status: "completed", product, message }` from `transaction_complete`
- `{ status: "abandoned", product, message }` from `transaction_abandon`
- `{ status: "failed", product, reason: "timeout" }` if `timeoutMs` (or
  `config.purchaseTimeoutMs`) elapses without a transaction message

`restore()` is fire-and-forget: the protocol has no restore-result event.

### Trial flow

The SDK signals introductory-offer eligibility via
`template_substitutions_prefix` (`"freeTrial"`), exposed as `snapshot.trial`
and `products.hasIntroductoryOffer` in conditional state.
`config.introductoryOfferEligibility` can force either way. On
`freeTrial_start` with a `trial_end_date`, the session schedules the config's
trial reminder (`schedule_notification`, id
`{paywallIdentifier}_TRIAL_STARTED`) — title/body run through `t()`.

### Mock host

```ts
import { createMockSuperwallTransport, mockOptionsFromConfig } from "@superwall/runtime"

const transport = createMockSuperwallTransport(
  mockOptionsFromConfig(config, { purchaseOutcome: "abandoned", latencyMs: 500 })
)
const superwall = createSuperwallSession({ config, transport })
```

The mock answers `ping` with `paywall_open`, `products` (one slot per config
entry, carrying the product identifier and nothing else — real product data
comes from Superwall, never from the mock), `template_variables` (products +
device + user + params), and trial eligibility; resolves purchase/restore
with transactions including `freeTrial_start`; grants permissions; answers
callbacks. `detectNativeSuperwallHost()` reports whether a real host is
present — used by `SuperwallProvider`'s `mock="auto"`.

## Develop

This package lives in the [`superwall/superwall`](https://github.com/superwall/superwall)
monorepo. **Read [AGENTS.md](https://github.com/superwall/superwall/blob/main/AGENTS.md)
first** - the conventions in it are decided, not suggested.

```bash
bun install
bun run test          # fixture tests drive the session through recorded
                      # message sequences and assert snapshot state — they
                      # are the protocol contract
bun run typecheck
```

There is no compile step in day-to-day development — `exports` point straight
at `src/`, so tests and consumers resolve the sources directly.

## License

[Functional Source License](https://github.com/superwall/superwall/blob/main/packages/superwall/LICENSE)
(FSL-1.1-ALv2): use it, modify it, embed it, ship it — anything except
building a competing product with it — and every release becomes Apache 2.0
two years after publication.
