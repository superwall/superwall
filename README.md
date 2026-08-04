<p align="center">
  <a href="https://superwall.com/">
    <img src="https://user-images.githubusercontent.com/3296904/158817914-144c66d0-572d-43a4-9d47-d7d0b711c6d7.png" alt="Superwall" height="100" />
  </a>
</p>

<h1 align="center">Superwall</h1>

<p align="center">
  Paywalls and funnels as code. An open-source framework for building
  paywalls and web funnels as mini React apps — deployed to Superwall.
</p>

Author every paywall and funnel as a real React app with file-based routing.
Everything is your code: your components, your design system, plain React —
the framework stays headless. Deploy to Superwall and the platform takes it
from there: products and purchases, localization, trials, experimentation and
A/B testing, and delivery through the native SDKs (iOS, Android, Flutter,
React Native) and the web.

```bash
npx superwall create   # scaffold a superwall/ directory in your app
superwall dev          # open the studio — every surface, live
superwall publish      # ship it
```

## A project is a directory

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
│       ├── app/              routes only — every .tsx here is a route
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
are local to it. Each surface's `config.ts` is required and is the whole truth
for that surface — there are no project-wide defaults to inherit. To share
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

Funnels sell on the web too: `definePaywall({ checkout: … })` puts Stripe
checkout in the page — as an embedded sheet, Apple Pay, or an external step —
so a web funnel goes from first screen to paid without leaving your code.

## Packages

| Package                                    | What it is                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`superwall`](packages/superwall)          | The framework: authoring API (`definePaywall`), React hooks + provider, `superwall/navigation` (the typed route stack), web checkout, discovery, and the dev server.                                                                                          |
| [`@superwall/cli`](packages/cli)           | The full management CLI: integrate, migrate, apps, products, campaigns, query, ASC, auth — plus the paywall commands (`create`, `dev`, `push`, `promote`, `publish`). The framework's `superwall` bin is a thin launcher for it — one command for everything. |
| [`@superwall/studio`](packages/studio)     | The local studio `superwall dev` opens: every surface as a live card, a device-frame editor with theme, locale, and variable overrides.                                                                                                                       |
| [`@superwall/runtime`](packages/runtime)   | Framework-agnostic runtime: bridge, session, product state, localization, purchase promises, mock SDK host. No React.                                                                                                                                         |
| [`@superwall/protocol`](packages/protocol) | The SDK ↔ paywall message contract: schemas, transports, initialization params.                                                                                                                                                                               |

Examples live in [`examples/`](examples) — each one a standalone, copyable
superwall project, teaching one capability with deliberately plain styling.
Start with [`minimal`](examples/minimal).

## Development

Requires [bun](https://bun.sh) ≥ 1.3.

```sh
bun install
bun dev                # studio over every example on http://localhost:6100
bun run test           # all package test suites
bun run typecheck      # tsc across all packages
bun run lint           # oxlint
bun run format         # oxfmt
```

There is no compile step in day-to-day development — packages point their
exports straight at their TypeScript sources, so tests, the dev server, and
consumers resolve `src/` directly.

Contributors and coding agents: read [AGENTS.md](AGENTS.md) before changing
anything — the conventions in it are decided, not suggested.

## License

The framework, runtime, protocol, and studio are licensed under the
[Functional Source License](LICENSE.md) (FSL-1.1-ALv2): use it, modify it,
embed it, ship it — anything except building a competing product with it —
and every release becomes Apache 2.0 two years after publication. The
[CLI](packages/cli) and all [examples](examples) are [MIT](packages/cli/LICENSE).
