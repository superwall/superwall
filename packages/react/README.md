# `@superwall/react`

Headless React primitives for code-first Superwall paywalls.

Any React app becomes a paywall: the components are yours, Superwall provides
products, purchases, localization, and the bridge to the native SDKs. This
package stays thin — the runtime lives in `@superwall/runtime`; React adds
context and hooks.

## Quickstart

```tsx
// superwall.config.ts — the paywall's contract
import { defineSuperwallConfig } from "@superwall/react"
import en from "./messages/en"
import de from "./messages/de"

export default defineSuperwallConfig({
  products: {
    primary: "pro_3999_year",
    secondary: "pro_999_month",
  },
  presentation: { style: "fullscreen" },
  localization: { defaultLocale: "en", messages: { en, de } },
})
```

```tsx
// main.tsx
import { SuperwallProvider } from "@superwall/react"
import config from "./superwall.config"

root.render(
  <SuperwallProvider config={config} mock="auto">
    <Paywall />
  </SuperwallProvider>
)
```

```tsx
// Paywall.tsx
import { useProducts, usePurchase, useTranslation } from "@superwall/react"

function Paywall() {
  const { products } = useProducts()
  const { purchase, isPurchasing } = usePurchase()
  const { t } = useTranslation()

  return (
    <>
      <h1>{t("paywall.title")}</h1>
      {products.map((product) => (
        <button
          key={product.reference}
          disabled={isPurchasing}
          onClick={() => purchase(product)}
        >
          {t(`products.${product.reference}.name`)} — {product.variables.price}
        </button>
      ))}
    </>
  )
}
```

## Config

`superwall.config.ts` declares everything the dashboard, build pipeline, and
runtime need to know about the paywall:

| Field                          | Type / values                                                               | What it does                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `products`                     | `{ [reference]: productId \| { productId } }`                               | Product slots the paywall renders. Product data (price, period, trial…) is SDK-owned and arrives at runtime. |
| `presentation.style`           | `"fullscreen" \| "modal" \| "push" \| "drawer" \| "popup" \| "noAnimation"` | How the SDK presents the paywall. `drawer`/`popup` take size options.                                        |
| `presentation.condition`       | `"checkUserSubscription" \| "always"`                                       | When to present.                                                                                             |
| `featureGating`                | `"gated" \| "nonGated"`                                                     | Whether users must pay to pass.                                                                              |
| `introductoryOfferEligibility` | `"automatic" \| "alwaysEligible" \| "alwaysIneligible"`                     | Trial eligibility handling; `automatic` lets the SDK decide.                                                 |
| `reRouteBackButton`            | `boolean`                                                                   | Route Android back presses into the paywall (`useBackButton`).                                               |
| `gameControllerEnabled`        | `boolean`                                                                   | Forward controller input (`useGameController`).                                                              |
| `scrollEnabled`                | `boolean`                                                                   | Whether the webview scrolls.                                                                                 |
| `onDeviceCacheEnabled`         | `boolean`                                                                   | Cache the paywall on device.                                                                                 |
| `managedPayments`              | `boolean`                                                                   | Use Superwall-managed payments where available.                                                              |
| `dismissOnPurchase`            | `boolean`                                                                   | Auto-dismiss after a completed purchase.                                                                     |
| `purchaseTimeoutMs`            | `number`                                                                    | Purchases resolve `{ status: "failed" }` after this long without a transaction.                              |
| `notifications.trialReminder`  | static or function                                                          | See Notifications.                                                                                           |
| `localization`                 | `{ defaultLocale, messages }`                                               | See `useTranslation`.                                                                                        |

### Notifications

Config-driven, auto-scheduled when the SDK reports a trial started
(`freeTrial_start`). Static form — strings run through `t()` so message keys
localize:

```ts
notifications: {
  trialReminder: {
    title: "notifications.trialReminder.title",
    body: "notifications.trialReminder.body",
    beforeTrialEndDays: 1,
  },
}
```

Dynamic form — compute timing and copy from the trial context; return `null`
to skip:

```ts
notifications: {
  trialReminder: ({ trialEndDate, product, t, locale }) => ({
    title: t("notifications.trialReminder.title"),
    body: t("notifications.trialReminder.body", {
      date: trialEndDate.toLocaleDateString(locale),
    }),
    delayMs: trialEndDate.getTime() - Date.now() - 12 * 60 * 60 * 1000,
  }),
}
```

## Hooks

Specialized hooks, one concern each — there is deliberately no kitchen-sink
hook.

### `useProducts()`

```tsx
const { products, getProduct } = useProducts()
```

Products keyed by reference, with SDK-owned `variables`: `price`, `rawPrice`,
`period`, `periodly`, `trialPeriodDays`, `trialPeriodText`, `currencyCode`,
`currencySymbol`, `monthlyPrice`, `yearlyPrice`, … (typed on
`SuperwallKnownProductVariables`).

`period` and `periodly` are localized automatically to the device locale
using the same translation table the schema-rendered runtime uses ("year" →
"año" for `es`). Prices arrive already localized from the store.

### `usePurchase()`

```tsx
const { purchase, isPurchasing, pendingProduct, transaction, failure } = usePurchase()

const result = await purchase("primary") // reference or product object
// result.status: "completed" | "abandoned" | "failed" — never throws for flow outcomes
```

Pending state is built in — no `useState(isPurchasing)`.

### `useActions()`

```tsx
const { close, restore, openUrl, openExternalUrl, openDeepLink,
        customPlacement, requestPermission, requestCallback,
        requestStoreReview, hapticFeedback } = useActions()
```

`restore()` is fire-and-forget: the message protocol has no restore-result
event. Successful restores surface as `transaction_complete`
(`useSuperwallEvent`) or a dismissed paywall. There is intentionally no
"update variable" action — React state replaces the schema editor's variable
system.

### `useTranslation()`

```tsx
const { t, locale, setLocale, locales } = useTranslation()

t("paywall.title")                        // resolved for the active locale
t("paywall.ctaTrial", { days: 7 })        // {days} interpolation
t("Literal copy stays as-is")             // unknown keys pass through
```

Locale is auto-detected from the device (`device.locale`), matched against
your catalogs (`pt-BR` → `pt` → `defaultLocale`), and overridable with
`setLocale`. Define catalogs as plain nested objects in `messages/{locale}.ts`
and pass them to `config.localization.messages`.

### `useTrialEligibility()`

```tsx
const { eligible } = useTrialEligibility()
// undefined until the SDK signals; then true/false
{eligible && <Badge>{t("paywall.ctaTrial", { days: product.variables.trialPeriodDays })}</Badge>}
```

Driven by the SDK's real eligibility signal (or forced via
`config.introductoryOfferEligibility`). Also exposed to conditional state as
`products.hasIntroductoryOffer`.

### `useVariables()` / `useDevice()` / `useUser()` / `useParams()`

```tsx
const { device, user, params } = useVariables()   // all SDK variable groups

const { platform, locale, osVersion, orientation } = useDevice()
const user = useUser()       // attributes set via Superwall.shared.setUserAttributes
const params = useParams()   // params passed to the presenting placement
```

`orientation` (`"portrait" | "landscape"`) is live viewport state; everything
else comes from SDK template variables.

### `useExperiment()`

```tsx
const experiment = useExperiment() // { experimentId, variantId, campaignId } | undefined
```

### Events

```tsx
useSuperwallEvent("transaction_complete", (message) => { /* typed */ })
useSuperwallEvent("message", (message) => { /* every incoming message */ })
useGameController((input) => { /* requires gameControllerEnabled */ })
useBackButton((input) => { /* requires reRouteBackButton */ })
```

### Advanced

`useSuperwallSnapshot()` (raw runtime snapshot) and `useSuperwallSession()`
(the underlying `SuperwallSession`) for anything the hooks don't model.

## Typed custom variables

```tsx
// superwall.ts — declare once, typed everywhere
import { createSuperwall } from "@superwall/react"

export const { SuperwallProvider, useProducts, usePurchase, useActions,
               useTranslation, useTrialEligibility, useDevice } =
  createSuperwall<{ badge?: string }>()
```

## Mock mode

`mock="auto"` simulates the native SDK when no real host is detected: products
get realistic synthesized variables, purchases resolve (including
`freeTrial_start` for trial products), permissions grant, device variables
arrive. Inside a real SDK webview or the editor preview, the mock stays out of
the way — the same build works everywhere.

```tsx
<SuperwallProvider config={config} mock="auto" />          // dev default
<SuperwallProvider config={config} mock />                 // always mock (tests)
<SuperwallProvider config={config} mock={{
  purchaseOutcome: "abandoned",
  trialEligible: false,
  latencyMs: 800,
  device: { locale: "de_DE" },
}} />
```
