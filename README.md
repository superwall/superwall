# superwall

The paywall framework. Author paywalls and funnels as mini React apps with
file-based routing; Superwall provides products, purchases, localization,
trials, A/B testing, and delivery through the native SDKs.

Everything Superwall-related lives in a `superwall/` directory at the root of
your app repo (or a dedicated repo):

```
superwall/
├── config.ts                 app-level defaults
├── components/               shared design system
├── messages/en.ts            shared strings, inherited by every surface
├── assets/                   shared images and fonts
├── paywalls/
│   └── plus-upgrade/         each paywall is a mini React app
│       ├── config.ts         products, experiment variables, preview overrides
│       ├── app/
│       │   ├── page.tsx      file-based routing, Next.js-style
│       │   ├── offer/page.tsx
│       │   └── layout.tsx    optional shared chrome
│       ├── components/
│       └── messages/en.ts
└── funnels/
    └── onboarding/           same shape — onboarding, web2app, win-back
```

Identity is the path: `paywalls/plus-upgrade` **is** the paywall's ID. No name
fields, no registration, no build config — the tooling owns bundling.

```tsx
// paywalls/plus-upgrade/app/page.tsx
import { useProducts, usePurchase, useTranslation } from "superwall";

export default function PlusUpgrade() {
  const { getProduct } = useProducts();
  const { purchase, isPurchasing } = usePurchase();
  const { t } = useTranslation();
  // your components, your design system — superwall is headless
}
```

`superwall dev` serves every surface against a **simulated SDK host**:
products get real-looking variables (or exactly the ones you declare in
`config.ts` → `preview`), purchases resolve, trials start. The same build runs
unchanged inside a real SDK webview — the mock detects a native host and
stays out of the way.

## Packages

| Package                                    | What it is                                                                                                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`superwall`](packages/superwall)          | The framework: authoring API (`defineConfig`, `definePaywall`, experiment `v`ariables), React hooks + provider, `superwall/navigation` (file-based router), discovery, and the dev server.                        |
| [`@superwall/cli`](packages/cli)           | The full management CLI (integrate, migrate, apps, products, campaigns, query, ASC, auth). The framework's `superwall` bin launches its shell and registers `dev`/`publish` into it — one command for everything. |
| [`@superwall/runtime`](packages/runtime)   | Framework-agnostic runtime: bridge, session, product state, localization, purchase promises, mock SDK host. No React.                                                                                             |
| [`@superwall/protocol`](packages/protocol) | The SDK ↔ paywall message contract: schemas, transports, initialization params.                                                                                                                                   |

Examples live in [`examples/`](examples) — `examples/chatgpt` recreates the
ChatGPT Plus upgrade paywall end to end.

## Development

Requires [bun](https://bun.sh) ≥ 1.3.

```sh
bun install
bun dev                # ChatGPT example on http://localhost:6100
bun run test           # all package test suites
bun run typecheck      # tsc across all packages
bun run lint           # oxlint
bun run format         # oxfmt
```

There is no compile step in day-to-day development — packages expose their
TypeScript sources through the `superwall-ts` exports condition, so tests,
the dev server, and consumers resolve `src/` directly.
