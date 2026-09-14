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
paywall is not React.

## What's here

This package is the paywall side of the SDK protocol. It owns transport
selection, base64 message ingestion, product state, localization, action
dispatch, and purchase promise resolution. It must not import React, or
anything above it in the stack. Hosts live elsewhere: the native SDKs, the
web host, and
[`@superwall/host`](https://github.com/superwall/superwall/tree/main/packages/host)
for the studio, the dashboard and tests. A session never invents a product or
a reply; everything in its snapshot arrived from a host.

| Directory           | Owns                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/bridge/`       | The wire: transport detection (`?platform=android`, `?transport=editor`, else WebKit), `detectSuperwallHost`, base64 batch decoding for `accept64`                          |
| `src/config/`       | The `SuperwallConfig` contract a running paywall reads, one file per concern (products, checkout, presentation, background, insets, notifications, localization)            |
| `src/localization/` | Locale resolution, the `t()` catalog, and `periods.ts` — the editor's period translation table, copied verbatim, with its lookup code trimmed of unreachable branches       |
| `src/products/`     | The product model, merging of `products` + `template_variables`, and derived variables (localized `period`/`periodly`, `trialPeriodEndDate`)                                |
| `src/session/`      | `createSuperwallSession`: outgoing message builders, purchase and request trackers, trial reminders, the incoming reducer, and the state `window.app.getAllState()` returns |

## Usage

```ts
import { createSuperwallSession, type SuperwallConfig } from "@superwall/runtime"

const config: SuperwallConfig = {
  products: { primary: "pro_3999_year" },
  notifications: {
    trialReminder: { title: "notifications.trialTitle", body: "…", beforeTrialEndDays: 1 },
  },
  localization: { defaultLocale: "en", messages: { en: { notifications: { trialTitle: "…" } } } },
}

const superwall = createSuperwallSession({ config })
superwall.start({ sendPing: true })

const { products, device, introductoryOffer, locale } = superwall.getSnapshot()
superwall.t("paywall.title")

const result = await superwall.purchase("primary")
// result.status: "completed" | "abandoned" | "failed" — never throws for flow outcomes

superwall.on("transaction_complete", (message) => {})
```

The session detects its host from the page. Pass `transport` to host it
yourself (tests, tools), or `transportKind` to force one.

### Purchase semantics

- `{ status: "completed", product, message }` from `transaction_complete`
- `{ status: "abandoned", product, message }` from `transaction_abandon`
- `{ status: "failed", product, reason: "sdk" }` from `transaction_fail` or
  `transaction_timeout` (iOS reports these; Android does not, so there a
  failed purchase stays pending until the user abandons or completes)
- `{ status: "failed", product, reason: "superseded" }` when a newer purchase
  of the same reference starts, or the paywall re-opens

The paywall runs no timer of its own: the SDK owns purchase timing.

What happens after a completed purchase is `config.postPurchase` (`"dismiss"`,
`"stay"`, or the web-only `"redeem"` / `{ redirect }`), overridable per call
with `purchase(ref, { postPurchase })`; natively it becomes `should_dismiss`
on the purchase message. `purchase(ref, { stripeMetadata })` is carried to web
checkout by the framework and ignored by store purchases.

A transaction is attributed to a pending purchase by reference, then by store
identifier, then, for a bare transaction, to the only pending purchase.

### Restore

`restore()` has no result to await. What the SDK reports lands on
`snapshot.restore` (`started`, `completed`, `failed`) and the `restore_start`,
`restore_complete`, `restore_fail` events. iOS reports all three; Android
reports only `restore_fail`.

### User attributes

`setUserAttributes({ email: "ada@example.com", plan: "pro" })` sends
`user_attribute_updated` — the wire the editor's "Set User Attribute" action
uses, so every host already merges and persists it — and applies the same
merge to `snapshot.user` (and `getAllState().user`) immediately. Hosts never
send variables back after an attribute update, so without the local merge the
paywall would keep reading the user as it was before its own action. Values
travel as strings; an empty object sends nothing.

### Introductory offers

The SDK signals eligibility via `template_substitutions_prefix`
(`"freeTrial"`), exposed as `snapshot.introductoryOffer.eligible` and
`products.hasIntroductoryOffer` in the SDK state. The store decides; a
paywall never overrides it. On `freeTrial_start` with a `trial_end_date`,
the session schedules the config's
trial reminder (`schedule_notification`, id
`{paywallIdentifier}_TRIAL_STARTED`) — title/body run through `t()`.

### The window interface

The framework's provider publishes what the native SDKs call into:
`window.paywall.accept64(base64)` for message batches and
`window.app.getAllState()` for the state object. `buildSuperwallState` builds
that object in the shape paywall.js exposes for editor paywalls, so an SDK
reads the same keys from both generations.

### Hosting a session in-process

```ts
import { createHostTransport, recordingDelegate } from "@superwall/host"

const { transport } = createHostTransport({
  state: { products: [{ reference: "primary", productId: "pro_3999_year", variables: { price: "$39.99" } }] },
  delegate: recordingDelegate({ purchase: "abandoned" }),
  latencyMs: 500,
})
const superwall = createSuperwallSession({ config, transport })
```

The host answers `ping` with the web host's burst and replies to purchase,
restore, permission and callback requests with the iOS SDK's messages. The
runtime's own tests are hosted this way.

## Develop

This package lives in the [`superwall/superwall`](https://github.com/superwall/superwall)
monorepo. **Read [AGENTS.md](https://github.com/superwall/superwall/blob/main/AGENTS.md)
first** - the conventions in it are decided, not suggested.

```bash
bun install
bun run test          # tests mirror src/: fixture-driven session tests are the protocol contract
bun run typecheck
```

There is no compile step in day-to-day development — `exports` point straight
at `src/`, so tests and consumers resolve the sources directly.

## License

[Functional Source License](https://github.com/superwall/superwall/blob/main/packages/superwall/LICENSE)
(FSL-1.1-ALv2): use it, modify it, embed it, ship it — anything except
building a competing product with it — and every release becomes Apache 2.0
two years after publication.
