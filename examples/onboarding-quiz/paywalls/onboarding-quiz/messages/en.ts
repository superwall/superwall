export default {
  index: {
    title: "Let's build your plan",
    subtitle: "Three questions. Takes about twenty seconds.",
    cta: "Get started",
  },
  quiz: {
    step: "Step {current} of {total}",
  },
  goal: {
    title: "What are you here for?",
    lose: {
      name: "Lose fat",
      hint: "Down a size, keep the strength",
    },
    build: {
      name: "Build muscle",
      hint: "Heavier, thicker, stronger",
    },
    endure: {
      name: "Go further",
      hint: "Runs, rides, long days",
    },
  },
  level: {
    title: "Where are you starting?",
    new: {
      name: "New to this",
      hint: "Never trained properly",
    },
    returning: {
      name: "Coming back",
      hint: "Been off for a while",
    },
    regular: {
      name: "Already training",
      hint: "Two or more times a week",
    },
  },
  time: {
    title: "How long have you got?",
    "15": {
      name: "15 minutes",
      hint: "Most days, quickly",
    },
    "30": {
      name: "30 minutes",
      hint: "The usual",
    },
    "45": {
      name: "45+ minutes",
      hint: "No rush",
    },
  },
  plan: {
    eyebrow: "Your plan",
    titleFallback: "Your plan",
    lose: {
      title: "Lean",
      blurb: "Steady deficit, plenty of walking, three lifts a week.",
    },
    build: {
      title: "Strong",
      blurb: "Progressive overload, four lifts a week, eat for it.",
    },
    endure: {
      title: "Distance",
      blurb: "Easy miles, one hard session, one long run.",
    },
    level: {
      new: "Starting from scratch",
      returning: "Getting back into it",
      regular: "Already training",
    },
    startingPoint: "Starting point",
    perSession: "Per session",
    minutes: "{minutes} minutes",
    empty: "—",
    cta: "Start · {price}",
    ctaBare: "Start",
    startOver: "Start over",
  },
  common: {
    close: "Close",
  },
  footer: {
    builtWith: "Built with",
    superwall: "Superwall",
  },
} as const;
