# superwall

The paywall framework. Author paywalls and funnels as mini React apps with
file-based routing; Superwall provides products, purchases, localization,
trials, A/B testing, and delivery through the native SDKs.

Everything Superwall-related lives in a `superwall/` directory at the root of
your app repo (or a dedicated repo):

```
superwall/
├── package.json              the project's own deps, and the project marker
├── superwall.lock            surface → paywall bindings (commit it)
├── components/               shared design system
├── messages/en.ts            shared strings, inherited by every surface
├── assets/                   shared images and fonts
├── paywalls/
│   └── plus-upgrade/         each paywall is a mini React app
│       ├── config.ts         required — name, products
│       ├── app/            routes only — every .tsx here is a route
│       │   ├── layout.tsx    optional — wraps every route
│       │   ├── index.tsx     where the flow starts
│       │   ├── plans.tsx     one file per route
│       │   └── goals/        directories prefix route names
│       │       └── setup.tsx "goals/setup"
│       ├── components/
│       └── messages/en.ts
└── funnels/
    └── onboarding/           same shape — onboarding, web2app, win-back
```

Identity is the path: `paywalls/plus-upgrade` **is** the paywall's ID. No name
fields, no registration, no build config — the tooling owns bundling. The
directory is a real npm project, so cloning it, installing, and running
`superwall dev` is all it takes to pick the work up somewhere else.

`components/`, `messages/`, and `assets/` work at both levels: at the
`superwall/` root they are shared by every surface, and inside a surface they
are local to it. Each paywall's `config.ts` is required and is the whole truth
for that paywall — there are no project-wide defaults to inherit. To share
settings, export a plain object and spread it:

```ts
// paywalls/plus-upgrade/config.ts
import { definePaywall } from "superwall/config";
import { shared } from "@/shared";

export default definePaywall({ ...shared, products: { plus: "plus_monthly" } });
```

```tsx
// paywalls/plus-upgrade/app/index.tsx
import { useProducts, usePurchase, useTranslation } from "superwall/hooks";

export default function PlusUpgrade() {
  const { getProduct } = useProducts();
  const { purchase, isPurchasing } = usePurchase();
  const { t } = useTranslation();
  // your components, your design system — superwall is headless
}
```

`superwall dev` serves every surface against a **stand-in SDK host**: purchases
resolve, trials start, and product data is read from Superwall — never invented,
so a price you see locally is a price a device would see. The same build runs
unchanged inside a real SDK webview; the stand-in detects a native host and
stays out of the way.

## Packages

| Package                                    | What it is                                                                                                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`superwall`](packages/superwall)          | The framework: authoring API (`definePaywall`, experiment `v`ariables), React hooks + provider, `superwall/navigation` (the typed route stack), discovery, and the dev server.                                    |
| [`@superwall/cli`](packages/cli)           | The full management CLI (integrate, migrate, apps, products, campaigns, query, ASC, auth). The framework's `superwall` bin launches its shell and registers `dev`/`publish` into it — one command for everything. |
| [`@superwall/runtime`](packages/runtime)   | Framework-agnostic runtime: bridge, session, product state, localization, purchase promises, mock SDK host. No React.                                                                                             |
| [`@superwall/protocol`](packages/protocol) | The SDK ↔ paywall message contract: schemas, transports, initialization params.                                                                                                                                   |

Examples live in [`examples/`](examples) — each one a standalone, copyable
superwall project, teaching one capability with deliberately plain styling.
Start with [`minimal`](examples/minimal).

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

There is no compile step in day-to-day development — packages point their
exports straight at their TypeScript sources, so tests, the dev server, and
consumers resolve `src/` directly.
