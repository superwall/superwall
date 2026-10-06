export default {
  paywall: {
    title: "Go Pro",
    subtitle: "Animated with Motion — the list staggers in, the price counts up to the store's figure.",
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
    cta: "Subscribe · {price}",
    ctaBare: "Subscribe",
    restore: "Restore purchases",
  },
  purchase: {
    failed: "That didn't go through. Try again.",
  },
  restore: {
    restored: "Purchases restored.",
    failed: "Nothing to restore, or the store didn't answer. Try again.",
  },
  common: {
    close: "Close",
  },
  footer: {
    builtWith: "Built with",
    superwall: "Superwall",
  },
} as const;
