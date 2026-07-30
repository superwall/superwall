# AGENTS.md

A multi-route onboarding flow, and the reference for how navigation works.
Like `examples/chatgpt`, this directory **is** a superwall project — copy it
into a real app as `superwall/`, or clone it as a dedicated repo.

Where `chatgpt` is one route, this one is five, and exists to exercise the
router: nested route names, layouts, per-route transitions, state shared across
the whole flow, and `page_view` reporting.

## The flow

```
paywalls/get-started/
  config.ts
  app/
    layout.tsx         wraps every route — the one reserved name
    styles.css         stylesheets may sit beside the routes that use them
    index.tsx          → "index"              welcome
    goals/
      index.tsx        → "goals"              pick a goal
      experience.tsx   → "goals/experience"   experience + days per week
    plans.tsx          → "plans"              personalized paywall
    terms.tsx          → "terms"
  components/
    Answers.tsx        the flow's shared state
    Choice.tsx
  messages/en.ts
```

**`app/` holds routes and nothing else.** Every `.tsx` in it is a route, a
directory becomes a name prefix, and `index.tsx` is the directory's own route.
The exceptions are `app/layout.tsx` and stylesheets. Components, hooks, and
context live in `components/`; anything else that turns up in `app/` is a
diagnostic — a warning while you `dev`, and a hard failure on `push`, since a
published version is immutable. That strictness is the point: you can never
accidentally publish a component as a route, or write a route no one can reach.

`app/index.tsx` is where every flow starts.

## Navigating

```tsx
const router = useRouter();

router.push("goals/experience");
router.push("plans", { transition: "fade" });
router.replace("terms");
router.back();
router.canGoBack();
router.dismiss(2);           // back two
router.dismissAll();         // back to index
router.dismissTo("goals");   // back to goals, or replace if it is not in the stack

router.name;                 // "goals/experience"
router.depth;                // 2
```

The names are expo-router's, so anything you know from Expo transfers. Closing
the paywall is not navigation — that stays `useActions().close()`.

Route names are **type-safe**: the CLI writes `superwall.d.ts` from your `app/`
directories on every `dev` and `push`, so `router.push("planz")` is a compile
error and your editor autocompletes the real list. That one file also declares
the asset modules behind `import hero from "./assets/hero.jpg"`. Commit it,
don't edit it, and don't delete it.

There are no paths and no URLs — a route is a name, and the whole flow ships as
one HTML file, so navigation never touches the network. Routes below the top
stay mounted: pop back and the route is exactly as it was left, which is why the
experience answers survive a Back. They are also `inert`, so nothing underneath
can be focused or clicked. Use `useIsFocused()` in a route that needs to pause
something (video, polling) while it sits below the top.

## Layouts

`app/layout.tsx` is an ordinary React component that receives the router's
output as `children`:

```tsx
export default function Layout({ children }: PropsWithChildren) {
  return (
    <div className="shell">
      <Chrome />
      {children}
    </div>
  );
}
```

It is optional — a single-route paywall needs no layout at all — and it stays
mounted for the life of the flow while routes come and go underneath it. That
is what makes it the right home for shared chrome _and_ for shared state.

## Sharing state across routes

There is no framework state API, and there should not be one. Because the
layout outlives every route, plain React context is the whole answer — see
`components/Answers.tsx`, whose values set on route 2 are read on route 4 to
build the headline. If an answer needs to reach Superwall for targeting, send it
explicitly with `customPlacement` or `setUserAttributes`.

## Transitions

Four of them: **`push`** (the default), `slide`, `fade`, `none`.

`push` is the iOS navigation push — the incoming route comes in from the right
with a soft edge shadow while the one behind it drifts left and dims, then
reverses on the way back. Its travel is clamped to 300px so a wide preview
doesn't slide half a screen.

`slide` moves both routes as one: the outgoing exits fully left while the
incoming arrives from the right, with no parallax, dim or shadow.

`fade` runs shorter (350ms) on a plain ease, because opacity has no momentum and
the movement spring drags on it. Only one layer ever fades — the incoming going
forward, the outgoing going back — since two half-faded layers would composite
to less than full opacity and flash the background through.

`none` is instant.

## Your own transitions

A transition is just a name the router stamps onto `data-sw-transition`, plus a
`data-sw-phase` telling each route which part of the movement it is playing:

| phase    | the route is…                       |
| -------- | ----------------------------------- |
| `enter`  | arriving on top                     |
| `recede` | being covered as you go forward     |
| `leave`  | dropping off the top as you go back |
| `return` | coming forward again as you go back |

The attribute is absent while a route is idle, so a rule can never leak outside
its transition, and a phase you leave out simply does not animate.

This project defines `zoom` at the bottom of `app/styles.css` and uses it as the
surface default in `config.ts` — a custom name works anywhere a built-in does.
The covered page grows past the viewport and fades while the arriving one comes
up from behind it, so the two read as one movement through depth:

```css
[data-sw-transition="zoom"][data-sw-phase="enter"]  { animation-name: zoom-enter }
[data-sw-transition="zoom"][data-sw-phase="recede"] { animation-name: zoom-recede }
[data-sw-transition="zoom"][data-sw-phase="leave"]  { animation-name: zoom-leave }
[data-sw-transition="zoom"][data-sw-phase="return"] { animation-name: zoom-return }

@keyframes zoom-enter  { from { opacity: 0; transform: scale(0.85) } }
@keyframes zoom-recede { to   { opacity: 0; transform: scale(1.15) } }
```

Duration is **read back from your CSS**, so a route stays mounted exactly as long
as its animation runs — no duration to declare twice. Wrap motion in
`@media (prefers-reduced-motion: no-preference)` as the built-ins do; with
reduced motion on the router settles immediately and skips the wait.

## Reporting

Every navigation emits `page_view` with the route name, the stack depth as
`flow_position`, and `entry`/`forward`/`back` — no wiring required.

`bun dev` (→ `superwall dev`) serves this at http://localhost:6100 against a
simulated SDK host.
