# teleport

A flow that starts in the app and finishes on the web: one question in the
app, then the plan opens in the shopper's browser, they pay with Stripe there,
and the app unlocks on its own.

```bash
superwall create --example teleport
superwall dev
```

## Products

The identifiers in `config.ts` are placeholders. `monthly` and `pro` are Stripe
products (`{environment}:{priceId}:{offer}`), `annual` is an App Store product.
Point them at products in your Superwall dashboard; until they match, prices
render undefined and publishing stays disabled.

## What this shows

```ts
export default definePaywall({
  teleport: { route: "plan", fallbacks: { monthly: "annual" } },
});
```

**One key moves the rest of the flow to the web.** In an iOS app,
`router.push("plan")` in `app/goal.tsx` doesn't push: it opens `plan` in the
shopper's browser, on your project's web paywall domain. The same paywall runs
there, so nothing is built twice.

**The answers come along.** `app/goal.tsx` keeps the goal with
`useQueryState`, and `app/plan.tsx` reads it back on the web page as if the
whole flow had been there. `useTeleport()` says where the teleport stands:
`plan.tsx` shows a line when its status is `"arrived"`.

**The app waits, then unlocks.** While the shopper is in the browser, the app
shows Superwall's teleport screen: Complete in Browser, Continue In-App Instead
(the `annual` fallback, bought through the App Store) and Cancel. Once they
pay, the page says "You're all set" with Return to App, and the app is
credited without a restore.

**It opens at once.** Because `route` is named, the teleport is prepared when
the paywall opens, so the tap goes straight to the browser.

**Back goes home.** On the web page, Back on `plan` returns to the app.

**Where teleport can't run,** on Android or an SDK before 4.18.0, `plan` opens
in the app as usual and a Stripe purchase goes to Superwall's hosted checkout.

## Next

- [`web-funnel`](../web-funnel) — a funnel sold entirely on the web
- [`apple-pay`](../apple-pay) — Apple Pay on the web page
