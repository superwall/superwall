export default {
  title: "Go Pro",
  subtitle: "Pay with Apple Pay in two taps. Cancel any time.",
  plans: {
    label: "Plans",
    trial: "3-day free trial",
    trialNote: "then billed monthly",
    intro: "3 days for {price}",
    introBare: "3 days at an intro price",
    introNote: "then billed monthly",
    monthly: "Monthly",
    monthlyNote: "billed every month",
    empty: "—",
  },
  promo: {
    placeholder: "Promo code",
    apply: "Apply",
    applying: "Checking…",
    remove: "Remove",
    unknown: "We don't recognize that code.",
    ineligible: "That code doesn't apply to these plans.",
    failed: "We couldn't check that code. Try again.",
    dropped: "That code is no longer valid, so it was removed.",
  },
  purchase: {
    continue: "Continue",
    restore: "Restore purchases",
    failed: "That didn't go through. Try again.",
  },
  restore: {
    restored: "Purchases restored.",
    failed: "Nothing to restore, or the store didn't answer. Try again.",
  },
  discount: {
    percentOff: "{percent}% off",
    amountOff: "{amount} off",
    once: "on your first payment",
    repeating: "for {months} months",
    forever: "forever",
    applied: "Code {code} applied",
  },
  common: {
    close: "Close",
  },
  footer: {
    builtWith: "Built with",
    superwall: "Superwall",
  },
} as const;
