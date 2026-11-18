# elements-checkout

Your own checkout form from Stripe's elements: wallet buttons, a card form and
a purchase button on one paywall, while superwall takes the payment.

```bash
superwall create --example elements-checkout
superwall dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at Stripe products
in your Superwall dashboard: that is the only place product data comes from,
so until they match, the studio says which are missing and the form reports
`unknown_product`.

## What this shows

```ts
checkout: { mode: "elements", prefetch: "trial" },
```

```tsx
import { PurchaseButton, useCheckout } from "superwall/checkout";
import {
  ExpressCheckoutElement,
  LinkAuthenticationElement,
  PaymentElement,
  StripeCheckout,
} from "superwall/checkout/stripe";

<StripeCheckout product={selected} onComplete={...} onFailure={...} onAbandon={...}>
  <ExpressCheckoutElement />
  <LinkAuthenticationElement />
  <PaymentElement />
  <PurchaseButton>Subscribe</PurchaseButton>
</StripeCheckout>
```

**The form is Stripe's own.** `PaymentElement` and `ExpressCheckoutElement`
come from `superwall/checkout/stripe`, with every option Stripe documents, so
the project installs nothing from Stripe. `options` on `<StripeCheckout>` styles them:
here the corner, accent, typeface and light or dark scheme follow the paywall.

**The shopper's email is required.** The subscription's Stripe customer
needs it for the receipt, redemption and the billing portal.
`LinkAuthenticationElement` collects it (and signs Link shoppers in), filled
in when the paywall already knows the user's `email` attribute; a wallet in
`ExpressCheckoutElement` always asks for it. Without either, `submit()`
returns `incomplete` with an `email_required` error and charges nothing.

**superwall does the purchase.** `<StripeCheckout>` prices the form from the
product, so it renders at once and nothing is created in Stripe until the
shopper pays. Paying runs 3D Secure and the free trial, then completes the
purchase with entitlements and redemption, the same way Apple Pay and the
sheet do. `usePurchase()`'s callbacks and the SDK's events fire for it too.

**Only the form is Stripe's.** `superwall/checkout` holds what every store's
form shares: `useCheckout()` and `<PurchaseButton>`. What is Stripe's own,
`<StripeCheckout>` and Stripe's elements, lives in `superwall/checkout/stripe`.
A paywall that never imports it never ships Stripe's React bindings.

**A wallet pays without the button.** Apple Pay, Google Pay and Link in
`ExpressCheckoutElement` complete the purchase on their own; closing the
wallet reports `onAbandon`.

**The form says what it is doing.** `useCheckout()` is read anywhere inside
`<StripeCheckout>`: `amounts` for the "due today" line and, when `dueNow` is
`0`, "Start free trial", `failure` for a declined card,
and `status` and `message` where the paywall can't take payment, such as
inside the iOS app. Unlike a store purchase, a card payment opens no sheet,
so `<PurchaseButton>` disables itself while it pays and the label says
"Paying…": otherwise the shopper sees nothing for a few seconds and taps again.

**Switching plans re-prices the form.** The plan rows only change `product`;
`<StripeCheckout>` loads that plan's price and Stripe's fields keep what the shopper
typed.

## Try it with a test card

In a test-mode project, `4242 4242 4242 4242` with any future date and CVC
pays; `4000 0000 0000 0002` is declined; `4000 0025 0000 3155` asks for
3D Secure.

## Next

- [`apple-pay`](../apple-pay): one key straight to the Apple Pay sheet
- [`web-funnel`](../web-funnel): Stripe's in-page sheet, prefetch per selection
