export default {
  index: {
    title: "Read more, faster",
    subtitle:
      "One question here, then your plan in the browser, where you pay and come straight back.",
    cta: "Get started",
  },
  goal: {
    title: "What are you after?",
    subtitle: "Your answer travels with you to the browser, so the plan there is already yours.",
  },
  goals: {
    focus: { label: "Focus", hint: "Fewer, longer sessions", phrase: "focus" },
    habit: { label: "Build a habit", hint: "A little every day", phrase: "building a habit" },
    catchUp: { label: "Catch up", hint: "Work through a backlog", phrase: "catching up" },
  },
  plan: {
    title: "Go Pro",
    forGoal: "A plan for {goal}.",
    body: "Pay here with Stripe, then head back to the app. It unlocks on its own.",
    fromApp: "Continued from the app.",
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
