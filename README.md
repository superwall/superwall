# superwall

The headless Superwall SDK monorepo: build paywalls as React components —
Superwall provides products, purchases, localization, trials, and the bridge
to the native SDKs.

```tsx
import { SuperwallProvider, useProducts, usePurchase, useTranslation } from "@superwall/react"

function Paywall() {
  const { products } = useProducts()
  const { purchase, isPurchasing } = usePurchase()
  const { t } = useTranslation()

  return products.map((product) => (
    <button
      key={product.reference}
      disabled={isPurchasing}
      onClick={() => purchase(product)}
    >
      {t("paywall.cta")} — {product.variables.price}
    </button>
  ))
}
```

The same build runs everywhere: in `dev` against a simulated SDK host
(products, purchases, and trials all behave like a real device) and unchanged
inside a real SDK webview — the mock detects a native host and stays out of
the way.

## Packages

The stack, bottom to top — each layer depends only on the one below it:

| Package                                    | What it is                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| [`@superwall/protocol`](packages/protocol) | The SDK ↔ paywall message contract: message schemas, transports, initialization params.                               |
| [`@superwall/runtime`](packages/runtime)   | Framework-agnostic runtime: bridge, session, product state, localization, purchase promises, mock SDK host. No React. |
| [`@superwall/react`](packages/react)       | Headless React primitives: `SuperwallProvider` + specialized hooks.                                                   |

The framework layer (filesystem conventions, CLI, dev server, build + push
pipeline) and example apps land on top of these packages next.

## Development

Requires [bun](https://bun.sh) ≥ 1.3.

```sh
bun install
bun run test           # all package test suites
bun run test:coverage  # with coverage
bun run typecheck      # tsc across all packages
bun run lint           # oxlint
bun run format         # oxfmt
```

There is no compile step in day-to-day development — packages expose their
TypeScript sources through the `superwall-ts` exports condition, so tests and
consumers resolve `src/` directly. `bun run build` emits `dist/` via tsc for
publishing.
