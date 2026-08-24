# transitions

One button per transition. Press one, watch it arrive; press Back, watch it
reverse.

```bash
superwall create --example transitions
superwall dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## The five built-ins

| transition | what it does                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `push`     | the iOS navigation push — the new route comes in from the right with an edge shadow while the one behind drifts left and dims |
| `slide`    | both routes move as one, flat: no parallax, no dim, no shadow                                                                 |
| `fade`     | a crossfade, shorter than the movement transitions and on a plain ease                                                        |
| `shift`    | the funnel step — the new route fades in as it drifts 44px into place, and the one it replaces is simply gone                 |
| `none`     | instant                                                                                                                       |

`push` is the default. Set one for a whole surface, override it per route, or
override that at the call site:

```ts
definePaywall({ transition: "slide" })      // surface
export const transition = "fade";           // one route
router.push("plans", { transition: "none" })// one navigation
```

A transition belongs to the _navigation_, not to a route: going forward uses the
incoming route's, going back uses the leaving one's — so a route always leaves
the way it arrived.

## Writing your own

`app/zoom.tsx` declares `transition = "zoom"`, which the framework knows nothing
about. It stamps `data-sw-transition="zoom"` on the route plus a
`data-sw-phase`, and `theme.css` does the rest:

| phase    | the route is…                       |
| -------- | ----------------------------------- |
| `enter`  | arriving on top                     |
| `recede` | being covered as you go forward     |
| `leave`  | dropping off the top as you go back |
| `return` | coming forward again as you go back |

```css
[data-sw-transition="zoom"][data-sw-phase="enter"]  { animation-name: zoom-enter }
[data-sw-transition="zoom"][data-sw-phase="recede"] { animation-name: zoom-recede }

@keyframes zoom-enter  { from { opacity: 0; transform: scale(0.85) } }
@keyframes zoom-recede { to   { opacity: 0; transform: scale(1.15) } }
```

The phase attribute disappears the moment a transition ends, so a rule can never
leak outside its own transition — there is no "is it finished" check to forget.
Name only the phases you want; the ones you leave out simply do not animate,
which is exactly how `fade` avoids animating both layers at once.

**Duration is read back from your CSS.** A route stays mounted for as long as
its animation runs, so nothing declares a duration twice. Wrap motion in
`@media (prefers-reduced-motion: no-preference)` as this example does — with
reduced motion on, the router settles immediately instead of waiting.

## Next

- [`with-motion`](../with-motion) — animating _inside_ a route
