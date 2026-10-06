export default {
  index: {
    title: "Read more, faster",
    subtitle: "Two questions, then your plan. This whole funnel is one paywall",
    cta: "Get started",
  },
  goal: {
    title: "What are you after?",
    subtitle: "The answer goes in the URL, so it survives a reload or a switch to another browser.",
  },
  goals: {
    focus: { label: "Focus", hint: "Fewer, longer sessions", phrase: "focus" },
    habit: { label: "Build a habit", hint: "A little every day", phrase: "building a habit" },
    catchUp: { label: "Catch up", hint: "Work through a backlog", phrase: "catching up" },
  },
  plan: {
    title: "Go Pro",
    forGoal: "A plan for {goal}.",
    body: "Payment happens right here — the sheet opens over this page.",
    monthly: "Monthly",
    pro: "Pro",
    empty: "—",
    cta: "Subscribe · {price}",
    ctaBare: "Subscribe",
    failed: "The payment didn't go through. Try again.",
  },
  common: {
    back: "Back",
  },
  footer: {
    builtWith: "Built with",
    superwall: "Superwall",
  },
} as const;
