export default {
  paywall: {
    title: "Try it free",
    trial: "{days} days, then it renews. We remind them the day before.",
    trialOne: "One day, then it renews. We remind them the day before.",
    trialBare: "Free for a while, then it renews. We remind them the day before.",
    reminderKey: "reminder",
    reminderScheduled: "scheduled",
    reminderPending: "on trial start",
    firesKey: "fires",
    firesValue: "1 day before it ends",
    noteDeclaredIn: "Declared in",
    noteRest:
      ", scheduled by the SDK when the trial starts. The paywall does not have to be open when it fires.",
    cta: "Start {days}-day trial",
    ctaBare: "Start free trial",
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
