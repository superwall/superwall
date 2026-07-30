# Examples

Each directory is a complete, standalone superwall project. Nothing is shared
between them — copy one anywhere and it runs:

```bash
superwall create <example>
cd <example> && bun install && bun dev
```

To browse several at once, point `dev` at all of them:

```bash
superwall dev examples/minimal examples/multi-page examples/transitions
```

The studio groups by project and the routes gain a project segment
(`/transitions/paywall/pro`). With a single project the URLs are unprefixed, as
before.

They teach **functionality, not design**. Styling is deliberately plain so the
mechanism is the thing you read.

## Fundamentals

| example                                    | teaches                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| [`minimal`](./minimal)                     | one route, one product, purchase — the baseline every other example builds on |
| [`product-selection`](./product-selection) | multiple products, selection state, prices from the store                     |

## Navigation

| example                        | teaches                                                        |
| ------------------------------ | -------------------------------------------------------------- |
| [`multi-page`](./multi-page)   | `router.push/back`, the route stack, `layout.tsx`              |
| [`transitions`](./transitions) | a button per transition — the four built-ins plus a custom one |

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
    config.ts         products, experiment variables, preview data
    app/              routes only, plus their .css and one layout.tsx
    components/       everything that is not a route
    messages/         one file per locale
```

`superwall.d.ts` is written by the CLI on every `dev` and `push`. Commit it —
it is what makes `import hero from "./assets/hero.jpg"` typecheck and
`router.push("plans")` reject typos.
