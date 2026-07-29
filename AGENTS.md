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
directory (or the repo root for dedicated repos). That directory is a real,
self-describing npm project — clone it, install, `superwall dev`:

- `superwall/package.json` + lockfile + `node_modules` — the project owns its
  own npm world (framework, react, react-dom), so a pure-native iOS/Android
  repo needs no npm scaffolding at its root. It is also the **marker**: a
  directory is a superwall project when its `package.json` depends on
  `superwall`. There is no project-level config file. The CLI scaffolds the
  `package.json` and a `.gitignore` write-if-absent. The package must never
  be named `superwall`: Node's self-reference rule would capture every bare
  `import "superwall"` inside it, and discovery hard-errors on it.
- **No project-wide defaults.** Each surface's `config.ts` is the whole truth
  for that surface; nothing is inherited or merged from above. Shared settings
  are composed explicitly — export a plain object, spread it into
  `definePaywall`.
- `superwall/components|messages|assets/` — the shared design system, strings
  (auto-discovered per locale, inherited by every surface), and assets. All
  three also work per-surface, inside `paywalls/<id>/`.
- `superwall/paywalls/<id>/` and `superwall/funnels/<id>/` — each surface is a
  mini React app: a **required** `config.ts` (`definePaywall`: products,
  experiment `variables`, dev-only `preview` mock overrides — a surface without
  it is invalid) + `app/page.tsx` file-based
  routing (nested folders are routes, `app/layout.tsx` optional) + local
  `components/` and `messages/`
- `superwall/superwall.lock` — the binding map (surface → paywall ID), and the
  only metadata file in the tree. Publish-time facts live in commit trailers,
  not on disk. **It is the binding of record**: a directory rename is detected
  (a bound id that no longer exists on disk, beside an unbound directory), never
  guessed — push prompts interactively, hard-errors in CI, and refuses to create
  a second paywall while an orphaned binding exists. The repeatable
  `--rename <old>=<new>` flag on push/publish is the non-interactive escape. A
  binding no rename claims is offered for removal interactively (lock-only —
  the paywall keeps serving, and restoring the directory re-binds it); a
  non-interactive run never mutates the lock without consent.
- Identity is the path. No name fields, no registration, and user projects
  never contain vite configs, index.html, or build tooling — the framework
  owns bundling. `@/…` aliases the `superwall/` directory.
- **Self-containment is allowed but recorded**: an import resolving outside
  the project (and outside `node_modules`) still builds, but push warns once
  naming each offender and stamps `Superwall-Portable: false` +
  `Superwall-External` on the commit, so the dashboard can grey out remote
  editing with a reason instead of failing.

Commands resolve the framework from `<cwd>/superwall/` first, then `<cwd>`,
so they work from the host root and from inside the directory alike; `.env` is
read from both, the project's own file winning.

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
- `packages/superwall` — `superwall`, THE framework. The public surface is
  split by concern, and no subpath entry may import the root barrel:
  `.` (slim: `SuperwallProvider`, its props, and the runtime types) ·
  `./config` · `./hooks` · `./navigation` · `./assets` (types only) ·
  `./internal` (message merging the generated entry needs — not public) ·
  `./build|./preview|./discover` (the CLI's tooling contract).
  - `src/config/` — the authoring contract: `definePaywall` (`paywall.ts`),
    experiment `v`ariables (`variables.ts`), message merging (`messages.ts`,
    re-exported through `src/internal.ts`)
  - `src/hooks/` — the specialized hooks (`useProducts`, `usePurchase`,
    `useActions`, `useTranslation`, …), one file each; the barrel also carries
    `createSuperwall` and `useSuperwallSession`
  - `src/provider/` — `SuperwallProvider` + session context (`context.ts`)
    and the typed `createSuperwall` factory (`create.ts`)
  - `src/navigation/` — `superwall/navigation`: the in-memory router behind
    file-based pages (`useRouter`, `Link`, `PaywallRouter`)
  - `src/discover.ts` — filesystem discovery (`superwall/` dir conventions),
    including the project `marker`. It never throws — a markerless directory
    is a valid answer; the CLI's `requireProject` is what fails loudly.
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
- `examples/chatgpt` — the example **is** a superwall project directory (not an
  app repo with one inside): `package.json` and the
  plus-upgrade paywall recreating the ChatGPT Plus screen, all at its root.
  Using it means copying the directory into a real app as `superwall/`. This
  also keeps bare-repo-root discovery exercised continuously. `bun dev` from
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

Day-to-day development has no compile step: package exports point straight at
`src/*.ts`, so vitest, TypeScript, and the dev server all resolve sources with
no extra resolution configuration.

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
  shell, yargs CLI orchestration, the studio app bootstrap), and each is
  exercised end-to-end by the real binaries. Adding an exclusion requires the
  same: a stated reason in the PR description and a real execution path that
  covers it.
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
- Write no comments in new code. Constraints, workarounds and other rationale go
  in the PR description, not beside code they will outlive. Leave existing
  comments alone unless you are changing the code they sit on.

## Roadmap context (do not build ahead of it)

Next on top of what exists: `superwall build` (immutable static bundles +
content-hashed manifests per surface — the push contract), `superwall push`
(content-addressed snapshots to Superwall, selectable in campaigns),
dashboard-driven experiment-variable overrides, and merging the published
management CLI (`../wizard`) into `packages/cli`. New examples and surfaces
are added under the maintainer's direction; do not scaffold them unprompted.
