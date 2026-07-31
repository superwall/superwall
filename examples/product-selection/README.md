# product-selection

Two plans, one selected, one call to action — the shape almost every real
paywall has.

```bash
superwall create --example product-selection
superwall dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

**Selection is ordinary React state.** There is no framework concept for "the
selected plan" — it is `useState`, and `purchase(selected)` takes the reference.

```tsx
const [selected, setSelected] = React.useState("annual");
…
<button onClick={() => purchase(selected)}>Continue</button>
```

**One product can show two prices.** The annual plan renders its own price and
its monthly equivalent, both from the store rather than arithmetic:

```tsx
product.variables.price; // "$59.99"
product.variables.monthlyPrice; // "$5.00"
```

**`components/` holds anything that is not a route.** `PlanOption` lives there;
`app/` only ever contains routes, their stylesheet and an optional `layout.tsx`.

**The group is a radiogroup.** Real `role`/`aria-checked` rather than styled
divs, so the choice is reachable without sight or a pointer.

## Next

- [`multi-page`](../multi-page) — carrying a choice across screens
- [`transitions`](../transitions) — how those screens arrive
