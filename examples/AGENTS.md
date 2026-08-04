# Writing a Superwall example

Read this before adding or changing anything under `examples/`. These are
decided conventions, not suggestions.

## What an example is

**The examples are the docs.** Someone lands on one to learn a single idea, and
the paywall itself has to teach it. That means an example is a real, shippable
paywall _and_ a piece of documentation at the same time: a title, a sentence
saying what this shows, then the thing itself — and where a concept has
variants, each variant explains itself on the page you land on.

Every example owns one idea. `transitions` teaches transitions and nothing
else. If you find yourself teaching two things, that is two examples.

## Non-negotiables

Every example, without exception:

1. **Uses the design system** (below). Not "looks similar to" — the same tokens.
2. **Is perfect in light and dark.** Both, always, checked in both.
3. **Is responsive from 320px to a tablet.** No fixed widths, no assumed height.
   Build for a thumb: primary actions are full width and at least 44px tall,
   and on a page with real content they belong at the bottom of the screen
   rather than trailing the copy.
4. **Ends with a Built with Superwall footer.**
5. **Stands alone.** Its own `package.json`, its own components, its own
   styles. Examples never import from each other — someone copies one directory
   and it works. Duplication between examples is correct.
6. **Declares its products** in `config.ts` and reads prices from
   `useProducts()`. Never hardcode a price; the identifiers are placeholders
   the reader repoints at their own.

## Treat it like a real paywall

An example is the reference someone copies, so it carries the habits a shipped
paywall has, even where the demo does not strictly need them:

- **Haptics on every meaningful tap.** `useHaptics()` — `light()` for
  navigation, `selection()` for changing a choice, `success()` when a purchase
  lands. iOS fires nothing of its own on navigation, so if the paywall does not
  ask for it there is no feedback at all.
- **Never put a purchase button in a loading state.** No "One moment…", no
  disabling it. The store sheet is the feedback, and the SDK owns it — a native
  paywall does not grey its own button out, and a paywall that does is lying
  about what it controls. `usePurchase()` exposes `isPurchasing` for the cases
  that genuinely need it; a buy button is not one of them.
- **Every control is reachable.** Icon-only buttons carry an `aria-label`; a
  tap target is at least 44px.
- **Prices come from `useProducts()`**, never from the file.

## Light and dark

The SDK decides. `SuperwallProvider` reads the device's interface style and
puts it on `<html>` as a `dark` or `light` class plus `color-scheme`, so an
example styles itself with plain CSS and writes no wiring at all:

```css
:root { --bg: #fdfef6; --fg: #0c0b0a; }
:root.dark { --bg: #1c1b19; --fg: #fdfef6; }
```

Where you need it in JS, `useColorScheme()` returns `"light" | "dark"` from the
same source.

Do **not** reach for `@media (prefers-color-scheme: dark)` as the mechanism. It
cannot see what the SDK reports, and it does not respond to the studio's theme
toggle — a paywall styled that way looks right on your machine and ignores the
device. The class is the mechanism; the media query is at best a fallback for a
host that reports nothing, and the provider already covers that case for you.

## Design system

The full system is at <https://superwall.com/design.md>. Examples use the
**application** register. The short version you need:

**Colour** — semantic tokens only, never a raw hex in a component.

| Token        | Light                                            | Dark                  |
| ------------ | ------------------------------------------------ | --------------------- |
| `--bg`       | `#fdfef6` (cream-100)                            | `#1c1b19`             |
| `--surface`  | `#f6f7ef`                                        | `#232220`             |
| `--elevated` | `#ffffff`                                        | `#2a2926`             |
| `--fg`       | `#0c0b0a` (black-500)                            | `#fdfef6` (cream-100) |
| `--fg-muted` | `color-mix(in srgb, var(--fg) 55%, transparent)` | same                  |
| `--border`   | `color-mix(in srgb, var(--fg) 12%, transparent)` | same                  |
| `--accent`   | `#46d7d4` (teal-300) — fixed in both modes       |                       |

**Type** — Manrope for everything, Roboto Mono for code and micro-labels.
Headings 500, body 400, emphasis 600. Never 700. Italic is reserved for mono.

| Level | Size                       | Weight | Line height | Tracking   |
| ----- | -------------------------- | ------ | ----------- | ---------- |
| H1    | `clamp(2rem, 7vw, 2.5rem)` | 500    | 1.1         | `-0.03em`  |
| H2    | `1.5rem`                   | 500    | 1.25        | `-0.02em`  |
| H3    | `1.25rem`                  | 500    | 1.3         | `-0.015em` |
| Body  | `0.9375rem`                | 400    | 1.5         | `-0.01em`  |
| Micro | `0.75rem` mono             | 500    | 1.2         | `+0.1em`   |

**Shape** — radius `0` everywhere. Fully-rounded (`9999px`) only for pills,
switches and dots. Borders are one `1px` hairline; never double up.

**No shadows.** The only permitted ring is a `2px` accent focus ring.

**Fill or border, never both** — except interactive panels (cards, sheets),
which keep a hairline over their fill so they read as objects.

**Motion** — `150ms ease` for colour and transform. Honour
`prefers-reduced-motion: reduce` on anything continuous.

**Muting ladder** — body `fg/85`, secondary `fg/70`, muted `fg/55`,
caption `fg/50`, metadata `fg/40`.

## Fonts

Manrope and Roboto Mono from Google Fonts, one `@import` at the top of the
stylesheet:

```css
@import url("https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&family=Roboto+Mono:wght@400..500&display=swap");
```

No dependency, no font files in the repo, the whole family in one line.

Put it in CSS rather than rendering `<link>` tags from a component. The
stylesheet is inlined into the snapshot's `<head>` at build time, so the browser
finds the `@import` while parsing the HTML, whereas a React-rendered link cannot
appear until the JS bundle has executed. Measured in WebKit against the built
snapshot, time until the font is actually painting:

| approach       | run 1  | run 2  | run 3  |
| -------------- | ------ | ------ | ------ |
| React `<link>` | 227 ms | 199 ms | 241 ms |
| CSS `@import`  | 282 ms | 192 ms | 191 ms |

Level, and the `@import` gets there without needing `preconnect`.

One family and one mono is the budget.

## Layout

```
examples/<name>/
├── package.json          standalone, name = <name>
├── tsconfig.json         standalone, no extends
├── superwall.d.ts
├── README.md             what it teaches, how to run, what to read next
└── paywalls/<name>/
    ├── config.ts         name, products
    ├── app/              routes only — every .tsx here is a route
    │   ├── index.tsx     the doc page
    │   ├── layout.tsx    chrome shared by every route, incl. the footer
    │   └── theme.css     tokens + primitives
    ├── components/       everything that is not a route
    └── assets/           fonts, images, .riv — only if the example ships one
```

`app/` holds routes and nothing else. A component in there is a build
diagnostic, not a style preference.

A project may also hold `funnels/<name>/`, and everything above applies to it
unchanged — same files, same rules. The framework discovers both directories;
which one a surface sits in is the only difference between them.

## Built with Superwall

Every example ends with it, in `layout.tsx` so no route can forget:

```tsx
<footer className="built">
  Built with
  <button
    type="button"
    className="wordmark"
    aria-label="Superwall"
    onClick={() => {
      haptics.light();
      openUrl("https://superwall.com");
    }}
  >
    <span className="wordmark-accent">$UPER</span>WALL
  </button>
</footer>
```

Text, not an image — it recolours with the theme for free and costs nothing to
load. The mark opens superwall.com through `useActions().openUrl`, never a raw
`<a href>`: inside a webview only the host can open a link, so an anchor either
does nothing or navigates the paywall away from itself.

## Before you call it done

- Toggle the studio between light and dark. Look at every route in both.
- Drag the preview from 320px wide to 900px. Nothing clipped, nothing stranded.
- `bun run typecheck` at the repo root.
- Read the paywall as a stranger. Does it teach the one idea it is named after?
