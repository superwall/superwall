export default {
  paywall: {
    title: "Go Pro",
    subtitle: "Animated with Motion — the list staggers in, the button reacts to touch.",
    noteBefore: "These animations start on the",
    noteAfter:
      "event rather than on mount — paywalls preload hidden, so a mount-timed animation has already played by the time anyone sees the page.",
    features: {
      projects: "Unlimited projects",
      stats: "Advanced stats",
      support: "Priority support",
      early: "Early features",
    },
    perYear: "/ year",
    cta: "Subscribe",
    restore: "Restore purchases",
    close: "Close",
  },
  footer: {
    builtWith: "Built with",
    superwall: "Superwall",
  },
} as const;
