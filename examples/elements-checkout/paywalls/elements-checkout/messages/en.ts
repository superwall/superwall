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
  scenarios: {
    label: "Checkout layout",
    full: "Wallets + card",
    cardFields: "Card fields",
    wallets: "Wallets only",
    billing: "With address",
    about: {
      full: "Apple Pay, Google Pay and Link buttons, an email field and Stripe's card form, paid with the built-in purchase button.",
      cardFields:
        "Separate card number, expiry and CVC fields, with the paywall's own email box and its own button.",
      wallets:
        "Only the wallet buttons, with no purchase button: the wallet pays and asks for the email itself.",
      billing:
        "An email field, Stripe's billing address form and its card form; the purchase also sends custom metadata.",
    },
  },
  form: {
    or: "or pay with card",
    email: "Email",
    cardNumber: "Card number",
    expiry: "Expiry",
    cvc: "CVC",
    incomplete: "Fill in every field.",
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
