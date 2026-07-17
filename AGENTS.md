# AGENTS.md

Guidance for coding agents (and humans) working in this repository.

## About this repo

The headless Superwall SDK: paywalls authored as React components, with
Superwall providing products, purchases, localization, trials, and the bridge
to the native SDKs (iOS / Android / Flutter / React Native — no native SDK
changes required; this speaks the same message protocol the schema-rendered
paywalls use).

Style the name as `superwall`, lowercase, in user-facing copy and docs.
"Superwall" (capitalized) refers to the platform/service.

## Repository layout

The stack, bottom to top — each layer depends only on the one below it:

- `packages/protocol` — `@superwall/protocol`: the SDK ↔ paywall message
  contract (zod message schemas, transports, initialization params).
  **Backward compatibility is sacred here**: old app binaries with old native
  SDKs load new paywall bundles indefinitely. Additive changes only.
- `packages/runtime` — `@superwall/runtime`: framework-agnostic runtime on top
  of the protocol. **No React imports allowed.** Layout:
  - `src/bridge/` — the wire layer: `SuperwallBridge` (transport
    auto-detection, message log, `accept`/`accept64`), transport/native-host
    detection, base64 message decoding
  - `src/session/` — the runtime model: the covariant `SuperwallSession`
    interface + implementation, its public types, SDK state building, and
    variable-group extraction
  - `src/localization/` — locale resolution, `t()` translator, and the
    period translation table
  - `src/config.ts` / `src/products.ts` / `src/mock.ts` — the paywall config
    contract, the product model + SDK merge logic, and the mock SDK host used
    by dev, previews, and tests
- `packages/react` — `@superwall/react`: `SuperwallProvider` + specialized
  hooks (`useProducts`, `usePurchase`, `useActions`, `useTranslation`,
  `useTrialEligibility`, …) over the runtime. Deliberately thin.

Each package has a README with its full API. Read it before changing the
package.

### Provenance / sync warning

`packages/protocol/src` was extracted 1:1 from the `paywall-js` slice of
`@superwall-me/schema` in the private paywall-next monorepo (`pwn`), and
`packages/runtime` + `packages/react` were ported from `pwn/packages/{runtime,react}`
(July 2026). Until pwn consumes these packages, the copies can drift — protocol
changes must be mirrored in both places. pwn's `pjs` parity tests
(schema-rendered paywalls sharing the runtime bridge) are the cross-check on
the other side.

## Commands

Requires bun ≥ 1.3. From the repo root:

```sh
bun install
bun run test            # all package test suites (vitest)
bun run test:coverage   # with v8 coverage
bun run typecheck       # tsc --noEmit across packages
bun run lint            # oxlint
bun run format          # oxfmt
bun run build           # dist output via tsc (publishing only)
```

Per package: `cd packages/<name>` then `bun run test` (watch mode),
`bun run test:run`, `bun run typecheck`.

Day-to-day development has no compile step: package exports list the
`superwall-ts` condition first, resolving straight to `src/*.ts` — vitest and
TypeScript are configured for it (`resolve.conditions` / `customConditions`).

Tooling is configured at the root and expected to stay green: `.oxlintrc.json`
(oxlint, zero findings), `.oxfmtrc.json` (oxfmt — run `bun run format` before
handing work back; `format:check` must pass), `.editorconfig`,
`.gitattributes`. Coverage thresholds are enforced in each package's
`vitest.config.ts` (`test:coverage` fails below them). There is deliberately
no CI workflow yet — add one (bun install → lint → typecheck → test) when the
repo gets a GitHub remote.

## Testing rules

- Every behavioral change comes with tests. Coverage is expected to stay
  effectively complete — if a branch is unreachable in tests, question the
  branch.
- Runtime fixture tests drive the session through recorded message sequences
  and assert snapshot state — **they are the protocol contract**. Never
  weaken an existing fixture to make a change pass; add new fixtures.
- React hooks are tested with @testing-library/react under jsdom
  (`packages/react/test/helpers.tsx` has the harness).
- Protocol schema tests parse representative real messages; when adding a
  message type, add accept AND reject cases.

## Conventions

- ESM only, TypeScript strict everywhere (shared `tsconfig.base.json`).
- No default exports in package source.
- **Type discipline: no assertions.** No `as any`, no `as unknown as`, no
  non-null `!`. Types are derived, and variance is engineered instead of cast
  around: `SuperwallSession` is a covariant (`out`) public interface over a
  base-typed implementation. The only permitted `as` casts are the small set
  of named, documented seams where TypeScript cannot express something real:
  - the custom-product-variables **claim seams** (`createSuperwallSession`,
    `useSuperwallSession`, `requestCallback`) — a caller's declaration about
    SDK-owned data, applied once and derived everywhere else;
  - the **SDK-trust boundaries** (`asProductVariables`, the transport
    no-op `Validator`) — wire data trusted for forward compatibility;
  - the event-store **correlation seam** (`handlersFor`,
    microsoft/TypeScript#47109);
  - **host-global views** (`window as typeof window & {…}` for
    SDK-injected/published globals).
    A new cast needs a justification of this kind in a comment, or it doesn't
    land.
- `purchase()` never throws for flow outcomes — it resolves
  `{ status: "completed" | "abandoned" | "failed" }`. Keep that contract.
- Product variables are SDK-owned; the runtime merges, never invents.
- Comments explain constraints the code can't show, not what the code does.

## Roadmap context (do not build ahead of it)

The framework layer — filesystem conventions (`paywalls/<id>/paywall.tsx`,
funnels), CLI (`dev`/`build`/`push`), dev shell, immutable content-addressed
builds — comes next on top of these packages, and the existing `superwall` CLI
(`../cli`, npm `superwall`) may fold into this repo. Apps and examples are
added under the maintainer's direction; do not scaffold them unprompted.
