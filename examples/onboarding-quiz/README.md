# onboarding-quiz

Answers that decide where you land.

```bash
superwall create --example onboarding-quiz
superwall dev
```

## Products

The identifiers in `config.ts` are placeholders. Point them at products that
exist in your Superwall dashboard — that is the only place product data comes
from, so until they match, the studio says which are missing, every price
renders undefined, and publishing stays disabled.

## What this shows

**Routes are names, not a sequence.** Any screen can push any other, which is
what makes branching possible at all.

**Every answer is saved the moment it is given**, as a user attribute. The
router carries no state and React state dies with the paywall, so an answer
kept anywhere else is gone when the user closes halfway. The host SDK keeps
attributes across presentations and launches, and `useUser()` sees a new one
at once:

```ts
const { setUserAttributes } = useActions();
setUserAttributes({ onboarding_goal: "build" });
```

The keys are stable snake_case names, because campaigns target on them and
analytics segment by them. Values come back as strings.

**The next presentation resumes at the first unanswered question.** The host's
attributes are in before the first render, so the first screen resets the stack
to every answered question and then that one in a layout effect, and the
resumed screen is the first thing that paints:

```ts
useLayoutEffect(() => router.reset(resumeStack(answers)), []);
```

Back and "Start over" behave as if the user had tapped through. Never store the
current step; the answers already say where the user is.

**`dismissAll()` returns to the first screen** without unwinding one at a
time.

## Next

- [`purchase-states`](../purchase-states) — what happens after the last screen
- [`web-funnel`](../web-funnel) — the same idea of steps, selling on the web
