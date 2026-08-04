# `@superwall/runtime`

Shared runtime core for SDK messaging — framework-agnostic.

This package is the runtime boundary shared by every paywall Superwall
serves — built with this framework or with the visual editor. It owns
transport selection, message logging, base64 message ingestion, product
state, localization, SDK action dispatch, and purchase promise resolution.
It must not import React, or anything above it in the stack.

## Layers

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

## Tests

`bun run test:run` — fixture tests drive the session through recorded
message sequences and assert snapshot state; they are the protocol contract.
