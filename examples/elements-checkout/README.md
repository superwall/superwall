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
the project installs nothing from Stripe. `options` on `<StripeCheckout>` styles them
(see [Matching the paywall's design](#matching-the-paywalls-design)), and
Stripe's labels and errors follow the paywall's locale unless `options.locale`
says otherwise.

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

The row of chips above the form switches between eight ways to build the
same purchase, so the paywall doubles as a playground. Each one says on the
page what it shows.

| Scenario                | Stripe pieces                                                                                         | What it shows                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Wallets + card          | `ExpressCheckoutElement`, `LinkAuthenticationElement`, `PaymentElement` (tabs)                        | The default layout, with `<PurchaseButton>`                                                                                                |
| Apple Pay + card fields | `ExpressCheckoutElement` (Apple Pay only), `CardNumberElement`, `CardExpiryElement`, `CardCvcElement` | `paymentMethods` turns off every other wallet; the paywall's own email box and button. Without Apple Pay, the card fields stand alone      |
| Card first              | `LinkAuthenticationElement`, `PaymentElement` (accordion), `ExpressCheckoutElement`                   | Any order: the card form first, the wallets below it                                                                                       |
| Card fields             | `CardNumberElement`, `CardExpiryElement`, `CardCvcElement`                                            | Separate card fields, the paywall's own email `<input>` passed as `<StripeCheckout email>`, and its own button on `useCheckout().submit()` |
| Single card line        | `CardElement`                                                                                         | Stripe's one-line card field with an email box and `<PurchaseButton>`                                                                      |
| Wallets only            | `ExpressCheckoutElement`                                                                              | No CTA: the wallet pays and asks for the email itself                                                                                      |
| With address            | `LinkAuthenticationElement`, `AddressElement` (billing), `PaymentElement` (accordion)                 | The billing address goes onto the payment method; `stripeMetadata` goes onto the subscription                                              |
| Promo code              | `LinkAuthenticationElement`, `PaymentElement`, `useDiscount()`                                        | A redeemed code re-prices the form: the due amount and the charge follow the discounted price                                              |

The wallet row renders nothing on a device with no wallet, so the example's
divider waits for `ExpressCheckoutElement`'s `onReady` to report one.

## Which Stripe elements work

`superwall/checkout/stripe` re-exports Stripe's own components unchanged, with
every option Stripe documents. Two are wrapped, because superwall needs their
events; their props are Stripe's, minus the handlers superwall owns.

| Element                                                                   | Supported | Notes                                                                                     |
| ------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------- |
| `PaymentElement`                                                          | Yes       | Cards and Link. `paymentMethodTypes` defaults to `["card", "link"]`                       |
| `ExpressCheckoutElement`                                                  | Wrapped   | Apple Pay, Google Pay, Link. superwall owns `onClick`, `onConfirm` and `onCancel`         |
| `LinkAuthenticationElement`                                               | Wrapped   | Hands the email to the purchase; filled in from the user's `email` attribute              |
| `AddressElement`                                                          | Yes       | `mode: "billing"`: the address goes onto the payment method                               |
| `CardElement`, `CardNumberElement`, `CardExpiryElement`, `CardCvcElement` | Yes       | The classic card fields; styled with `options.style`, not `appearance`                    |
| `useStripe()`, `useElements()`                                            | Yes       | For reading the form; don't confirm with them, call `useCheckout().submit()`              |
| `ShippingAddressElement`, `AddressElement` with `mode: "shipping"`        | No        | A subscription ships nothing, and the purchase has nowhere to send it                     |
| `TaxIdElement`                                                            | No        | The purchase has nowhere to send a tax ID                                                 |
| `IbanElement`, SEPA, ACH, iDEAL, Klarna, Afterpay, Cash App Pay           | No        | They redirect or need a bank mandate: a return-and-resume flow superwall doesn't have yet |
| `PaymentMethodMessagingElement`                                           | No        | It advertises the buy-now-pay-later methods above                                         |
| `EmbeddedCheckout`, `CheckoutProvider`                                    | No        | Stripe's own hosted checkout: use `checkout: "sheet"` instead                             |

Saved cards and a customer's earlier payment methods aren't offered: the form
pays as a new customer each time.

## Matching the paywall's design

Stripe draws its fields in its own frame, so they can't read the paywall's
CSS. [`components/appearance.ts`](paywalls/elements-checkout/components/appearance.ts)
reads the paywall's tokens from `theme.css` once per light or dark scheme,
resolves each to a plain colour, and passes them to Stripe:

- **`appearance.variables`**: the field background is `--surface`, the same
  as the plan rows; text, placeholder, accent, danger colour, font, size and
  the 3px corner come from the tokens too.
- **`appearance.rules`**: a hairline border and no shadow on `.Input`,
  `.Tab`, `.AccordionItem` and `.Block` (Link's "save my information" box),
  and the accent edge on focus, so every field matches the paywall's inputs.
- **`fonts`**: the font file itself, `{ family, src: "url(...woff2)" }`.
  Stripe fetches a `cssSrc` stylesheet from the paywall's page, where the
  hosted page's Content Security Policy blocks Google Fonts; a font file
  loads inside Stripe's frame instead.
- **The classic card fields** take `options.style` instead (`useCardStyle()`
  in the same file), and the paywall's own `.input` class gives their frame
  the same surface, border and focus edge.

Keep the options object stable with `useMemo`: a new object on every render
makes Stripe redraw every field.

## Migrating an existing checkout

A custom Stripe checkout usually has an `<Elements>` provider with a client
secret, a server endpoint that creates the PaymentIntent or subscription, a
`stripe.confirmPayment()` call on submit and a webhook that grants access.
With superwall:

1. **Set the mode.** `checkout: { mode: "elements" }` in `config.ts`, and
   the Stripe products in `products`.
2. **Swap the provider.** Replace `<Elements stripe={...} options={{ clientSecret }}>`
   with `<StripeCheckout product="annual">`. Move `appearance`, `fonts`,
   `locale` and `paymentMethodTypes` into its `options`; drop `clientSecret`,
   `mode`, `amount` and `currency`, which come from the product.
3. **Keep the elements.** Import them from `superwall/checkout/stripe`
   instead of `@stripe/react-stripe-js`, with the same props.
4. **Swap the submit.** Where you called `elements.submit()` and
   `stripe.confirmPayment()`, call `useCheckout().submit()`, or render
   `<PurchaseButton>`. 3D Secure, trials and failures are handled.
5. **Collect the email.** Keep `LinkAuthenticationElement`, or pass your
   own field's value as `<StripeCheckout email>`.
6. **Move the metadata.** What you put on the subscription goes in
   `stripeMetadata`.
7. **Delete the backend.** The PaymentIntent endpoint and the
   access-granting webhook go: superwall creates the subscription, grants the
   entitlement and redeems it in the app.
8. **Move the reactions.** Your success and error handling moves to
   `onComplete`, `onFailure` and `onAbandon` on `<StripeCheckout>`, or to
   `usePurchase()`'s callbacks.

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
