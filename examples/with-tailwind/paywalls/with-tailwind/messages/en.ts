export default {
  paywall: {
    title: "Go Pro",
    subtitle: "This paywall is styled with Tailwind.",
    features: {
      projects: "Unlimited projects",
      stats: "Advanced stats",
      support: "Priority support",
    },
    noteBefore: "Dark mode is the",
    noteMiddle: "variant, driven by the class the SDK already puts on",
    noteAfter: ".",
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
