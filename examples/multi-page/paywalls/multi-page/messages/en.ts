export default {
  index: {
    title: "Meet Pro",
    subtitle: "Three screens in one paywall. Every file in app/ is a screen.",
    tree: {
      here: "you are here",
      layout: "the chrome above and below",
    },
    route: {
      before: "The filename is the route name —",
      after: ". No config, no registry, and all three ship in one snapshot.",
    },
    cta: "See what you get",
  },
  features: {
    title: "What you get",
    items: {
      projects: "Unlimited projects",
      offline: "Offline access",
      support: "Priority support",
      forever: "Everything, forever",
    },
    cta: "Choose a plan",
  },
  plans: {
    title: "Go annual",
    perMonth: "{price} a month, billed annually.",
    cta: "Subscribe · {price}",
    ctaBare: "Subscribe",
    restore: "Restore purchases",
    startOver: "Start over",
  },
  chrome: {
    back: "Back",
    step: "{current} of {total}",
    close: "Close",
  },
  footer: {
    builtWith: "Built with",
    superwall: "Superwall",
  },
} as const;
