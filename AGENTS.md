# AGENTS.md

Guidance for coding agents (and humans) working in this repository.

## About this repo

The superwall framework: paywalls and funnels authored as mini React apps
with file-based routing, with Superwall providing products, purchases,
localization, trials, and the bridge to the native SDKs (iOS / Android /
Flutter / React Native — no native SDK changes required; this speaks the same
message protocol the schema-rendered paywalls use).

Style the name as `superwall`, lowercase, in user-facing copy and docs.
"Superwall" (capitalized) refers to the platform/service.

## Project conventions (what the framework serves)

Everything Superwall-related in a user's repo lives in a `superwall/`
directory (or the repo root for dedicated repos):

- `superwall/config.ts` — app-level defaults (`defineConfig`)
- `superwall/components|messages|assets/` — the shared design system, strings
  (auto-discovered per locale, inherited by every surface), and assets
- `superwall/paywalls/<id>/` and `superwall/funnels/<id>/` — each surface is a
  mini React app: `config.ts` (`definePaywall`: products, experiment
  `variables`, dev-only `preview` mock overrides) + `app/page.tsx` file-based
  routing (nested folders are routes, `app/layout.tsx` optional) + local
  `components/` and `messages/`
- Identity is the path. No name fields, no registration, and user projects
  never contain vite configs, index.html, or build tooling — the framework
  owns bundling. `@/…` aliases the `superwall/` directory.

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
- `packages/superwall` — `superwall`, THE framework (one root import):
  - `src/config/` — the authoring contract: `defineConfig` (`app.ts`),
    `definePaywall` (`paywall.ts`), experiment `v`ariables (`variables.ts`),
    message merging (`messages.ts`)
  - `src/hooks/` — the specialized hooks (`useProducts`, `usePurchase`,
    `useActions`, `useTranslation`, …), one file each
  - `src/provider/` — `SuperwallProvider` + session context (`context.ts`)
    and the typed `createSuperwall` factory (`create.ts`)
  - `src/navigation/` — `superwall/navigation`: the in-memory router behind
    file-based pages (`useRouter`, `Link`, `PaywallRouter`)
  - `src/discover.ts` — filesystem discovery (`superwall/` dir conventions)
  - `src/lock.ts` — read-only view of `superwall.lock` (the CLI writes it)
  - `src/document.ts` — **the artifact contract**: the HTML a paywall _is_
    (`renderDocument`, `data-sw-*` semantics) and the platform layer the
    runtime wraps it in (`injectPlatformLayer`). The build and the preview
    server both render through it, so local and published are the same
    document. Nothing else may enter it.
  - `src/build/` — `superwall/build`: one surface → one self-contained,
    content-addressed HTML snapshot
  - `src/preview/` — `superwall/preview`: serving surfaces locally the way
    the runtime serves published snapshots — `server.ts` (vite; studio dist,
    project payload, surface previews), `mount.tsx`/`surface.tsx` (what runs
    inside the iframe), `overrides.ts` (theme/locale/device query params),
    `webview.ts` (the one deliberate local-only difference)
- `packages/cli` — `@superwall/cli`: THE command surface, migrated from the
  standalone `superwall/cli` repo (integrate/migrate/review, apps, products,
  campaigns, query, ASC, auth, telemetry; yargs + ink) **plus the paywall
  commands** (`dev`, `push`, `promote`, `publish` in `src/commands/`, shared
  machinery in `src/core/paywalls/`). Paywall commands load the framework
  dynamically from the project's own install
  (`core/paywalls/framework.ts`) — the CLI never hard-depends on a framework
  version, and commands always run against the project's lockfile. It owns
  **no bin** — it exports `main()`, and the framework's `superwall` bin
  (prefer-local launcher + tsx + project `.env`) starts it. Dependency
  direction: framework → cli for the bin, cli → framework only dynamically
  at command runtime. This package is **excluded from oxfmt/oxlint**
  (imported codebase, upstream-diffable, own conventions) and is consumed
  **built** (tsdown → `dist/`; root `postinstall` builds it).
- `examples/chatgpt` — an app-repo-shaped example: `superwall/` directory with
  the plus-upgrade paywall recreating the ChatGPT Plus screen. `bun dev` from
  the repo root serves it.

Each package has a README with its full API. Read it before changing the
package.

### Provenance / sync warning

`packages/protocol/src` was extracted 1:1 from the `paywall-js` slice of
`@superwall-me/schema` in the private paywall-next monorepo (`pwn`), and
`packages/runtime` + the framework's `src/react/` were ported from
`pwn/packages/{runtime,react}` (July 2026). Until pwn consumes these packages,
the copies can drift — protocol changes must be mirrored in both places. pwn's
`pjs` parity tests (schema-rendered paywalls sharing the runtime bridge) are
the cross-check on the other side.

## Commands

Requires bun ≥ 1.3. From the repo root:

```sh
bun install
bun dev                 # examples/chatgpt on http://localhost:6100
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
`vitest.config.ts` (`test:coverage` fails below them). CI lives at
`.github/workflows/ci.yml`: install (postinstall builds cli + studio) →
lint → format:check → typecheck → test:coverage. Every gate that runs in CI
runs identically on a laptop — keep it that way.

## Testing rules

- Every behavioral change comes with tests. Coverage is expected to stay
  effectively complete — if a branch is unreachable in tests, question the
  branch.
- Runtime fixture tests drive the session through recorded message sequences
  and assert snapshot state — **they are the protocol contract**. Never
  weaken an existing fixture to make a change pass; add new fixtures.
- React hooks are tested with @testing-library/react under jsdom
  (`packages/superwall/test/react/helpers.tsx` has the harness).
- Protocol schema tests parse representative real messages; when adding a
  message type, add accept AND reject cases.
- Run `bun run test:coverage` before handing work back — thresholds are
  gates, not decoration. The only files excluded from unit coverage are
  process-level integrations vitest cannot host (vite dev server + browser
  shell, `superwall push`'s vite build, yargs CLI orchestration, the studio
  app bootstrap); each exclusion is justified inline in that package's
  `vitest.config.ts` and is exercised end-to-end by the real binaries. Adding
  an exclusion requires the same: a reason in the config and a real execution
  path that covers it.
- Code with I/O at its edges is written with an injectable seam so the logic
  is unit-testable (`buildStudioProject`'s config loader, `resolveBinding`
  over the mocked API client) — follow that pattern instead of widening the
  exclusion list.

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

Next on top of what exists: `superwall build` (immutable static bundles +
content-hashed manifests per surface — the push contract), `superwall push`
(content-addressed snapshots to Superwall, selectable in campaigns),
dashboard-driven experiment-variable overrides, and merging the published
management CLI (`../wizard`) into `packages/cli`. New examples and surfaces
are added under the maintainer's direction; do not scaffold them unprompted.
