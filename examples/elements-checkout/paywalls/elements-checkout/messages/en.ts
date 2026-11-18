export default {
  title: "Go Pro",
  subtitle: "Pay with a wallet in one tap, or with a card. Cancel any time.",
  plans: {
    label: "Plans",
    trial: "3-day free trial",
    trialNote: "then billed monthly",
    monthly: "Monthly",
    monthlyNote: "billed every month",
    empty: "—",
  },
  form: {
    or: "or pay with card",
    dueToday: "Due today",
    renews: "then {price} every {interval}",
  },
  purchase: {
    subscribe: "Subscribe",
    startTrial: "Start free trial",
    paying: "Paying…",
    completed: "You're in. Welcome to Pro.",
    failed: "That didn't go through. {reason} Try another card.",
    declined: "Your payment was declined.",
    unavailable: "Payment isn't available here: {message}",
  },
  common: {
    close: "Close",
  },
  footer: {
    builtWith: "Built with",
    superwall: "Superwall",
  },
} as const;
