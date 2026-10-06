# Examples

Each directory is a complete, standalone superwall project. Nothing is shared
between them — copy one anywhere and it runs. `superwall create` is the copy:
it rewrites the `workspace:*` dependency these carry into a real version, so
the result installs outside this repo.

```bash
superwall create --example <example>
superwall dev
```

To browse several at once, point `dev` at all of them:

```bash
superwall dev examples/minimal examples/multi-page examples/transitions
```

The studio groups by project and the routes gain a project segment
(`/transitions/paywall/transitions` — the last segment is the surface's
directory name). With a single project the URLs are unprefixed.

They teach **functionality, not design**. Styling is deliberately plain so the
mechanism is the thing you read: every `theme.css` starts with the same
sheet `superwall create` writes (cream paper in light, one cool-grey ramp in
dark, Manrope, one 3px corner, one teal accent, press feedback on every
control), and only the rules the example needs follow it.

## Fundamentals

| example                                    | teaches                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| [`minimal`](./minimal)                     | one route, one product, purchase — the baseline every other example builds on |
| [`product-selection`](./product-selection) | multiple products, selection state, prices from the store                     |

## Navigation

| example                                | teaches                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| [`multi-page`](./multi-page)           | `router.push/back`, the route stack, `layout.tsx`              |
| [`transitions`](./transitions)         | a button per transition — the five built-ins plus a custom one |
| [`onboarding-quiz`](./onboarding-quiz) | answers decide where you land; the router carries no state     |
| [`animated-onboarding`](./animated-onboarding) | every hand-off choreographed: the answer becomes the bar, the photo, the colour |

## Purchases

| example                                    | teaches                                                              |
| ------------------------------------------ | -------------------------------------------------------------------- |
| [`purchase-states`](./purchase-states)     | what `purchase()` resolves with, and what the SDK reports on its own |
| [`trial-eligibility`](./trial-eligibility) | two paywalls in one, chosen by the store                             |
| [`abandonment-offer`](./abandonment-offer) | `purchase()` resolves abandoned — push a last-chance offer           |
| [`trial-reminders`](./trial-reminders)     | a local notification scheduled when the trial starts                 |
| [`web-funnel`](./web-funnel)               | selling on the web: steps, then Stripe checkout in the page          |
| [`apple-pay`](./apple-pay)                 | Apple Pay on the web, trials quoted to the sheet, a promo code       |

## The host

| example                                | teaches                                                   |
| -------------------------------------- | --------------------------------------------------------- |
| [`personalization`](./personalization) | `useVariables()` — device, user and placement params      |
| [`permissions`](./permissions)         | `requestPermission` / `requestCallback` — the app answers |

## Look and feel

| example                            | teaches                                            |
| ---------------------------------- | -------------------------------------------------- |
| [`custom-fonts`](./custom-fonts)   | a typeface you supply, from a file in your project |
| [`with-tailwind`](./with-tailwind) | Tailwind v4 with zero framework configuration      |
| [`with-motion`](./with-motion)     | in-page animation; transitions stay the router's   |
| [`with-rive`](./with-rive)         | interactive vector animation on a canvas           |
| [`orientation`](./orientation)     | a layout that answers to the device                |

## Localization

| example                          | teaches                                                          |
| -------------------------------- | ---------------------------------------------------------------- |
| [`localization`](./localization) | multiple locales, shared + surface-local messages, interpolation |

---

Every example follows the same shape:

```
<example>/
  package.json        depends on superwall, react, react-dom
  tsconfig.json       standalone — no monorepo base to extend
  superwall.d.ts      generated: asset modules + typed route names
  paywalls/<id>/
    config.ts         name and products
    app/              routes only, plus their .css and one layout.tsx
    components/       everything that is not a route
    messages/         one file per locale
  funnels/<id>/       optional, and exactly the same shape
```

A project can hold both. The framework discovers `paywalls/` and `funnels/`
alike, and the CLI pushes both — the directory a surface sits in is the only
thing that distinguishes them.

`superwall.d.ts` is written by the CLI on every `dev` and `push`. Commit it —
it is what makes `import hero from "./assets/hero.jpg"` typecheck and
`router.push("plans")` reject typos.
