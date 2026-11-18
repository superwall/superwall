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

## Scenarios

The row of chips above the form switches between four ways to build the
same purchase, so the paywall doubles as a playground:

| Scenario       | Stripe pieces                                                                         | What it shows                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Wallets + card | `ExpressCheckoutElement`, `LinkAuthenticationElement`, `PaymentElement` (tabs)        | The default layout, with `<PurchaseButton>`                                                                                                |
| Card fields    | `CardNumberElement`, `CardExpiryElement`, `CardCvcElement`                            | Separate card fields, the paywall's own email `<input>` passed as `<StripeCheckout email>`, and its own button on `useCheckout().submit()` |
| Wallets only   | `ExpressCheckoutElement`                                                              | No CTA: the wallet pays and asks for the email itself                                                                                      |
| With address   | `LinkAuthenticationElement`, `AddressElement` (billing), `PaymentElement` (accordion) | The billing address goes onto the payment method; `stripeMetadata` goes onto the subscription                                              |

**Which Stripe elements work.** `superwall/checkout/stripe` re-exports
Stripe's own components unchanged: `PaymentElement`, `AddressElement`,
`PaymentMethodMessagingElement`, `CardElement` and the three separate card
fields, plus `useStripe()` and `useElements()`. Two are wrapped, because
superwall needs their events: `ExpressCheckoutElement` (it pays and reports
abandons) and `LinkAuthenticationElement` (it hands over the email). Elements
that redirect (iDEAL, Klarna), collect a bank account (`IbanElement`) or have
nowhere to send their data (`TaxIdElement`, `ShippingAddressElement`) aren't
exported.

**Porting an existing form.** Keep the elements and their options; drop your
`<Elements>` provider, your PaymentIntent endpoint and your
`stripe.confirmPayment()` call. Wrap the form in `<StripeCheckout product>`
and call `useCheckout().submit()` (or render `<PurchaseButton>`) where you
confirmed before.

**No email, no payment.** Every purchase needs an email. Without
`LinkAuthenticationElement`, a wallet, the `email` prop or the user's `email`
attribute, the form logs a warning when it is ready, and `submit()` returns
`incomplete` with `email_required` and charges nothing.

## Try it with a test card

In a test-mode project, `4242 4242 4242 4242` with any future date and CVC
pays; `4000 0000 0000 0002` is declined; `4000 0025 0000 3155` asks for
3D Secure.

## Next

- [`apple-pay`](../apple-pay): one key straight to the Apple Pay sheet
- [`web-funnel`](../web-funnel): Stripe's in-page sheet, prefetch per selection
