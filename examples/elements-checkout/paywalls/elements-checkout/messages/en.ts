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
    applePayLink: "Apple Pay + Link + card",
    applePayOnly: "Apple Pay only",
    full: "Wallets + card",
    applePayCard: "Apple Pay + card fields",
    cardFirst: "Card first",
    cardFields: "Card fields",
    singleLine: "Single card line",
    wallets: "Wallets only",
    billing: "With address",
    promo: "Promo code",
    about: {
      applePayLink:
        "The recommended layout: superwall's own Apple Pay sheet on its own button, Link in Stripe's express row, then the card form with no wallets of its own.",
      applePayOnly:
        "Only superwall's Apple Pay sheet, opened from the paywall's own button, exactly as a checkout: \"applePay\" paywall opens it.",
      full: "Apple Pay, Google Pay and Link buttons, an email field and Stripe's card form, paid with the built-in purchase button.",
      applePayCard:
        "Only the Apple Pay button above separate card fields, with the paywall's own email box and button. Without Apple Pay, the card fields stand alone.",
      cardFirst:
        "Stripe's card form first and the wallet buttons below it: the elements go in any order the paywall likes.",
      cardFields:
        "Separate card number, expiry and CVC fields, with the paywall's own email box and its own button.",
      singleLine:
        "Stripe's one-line card field with the paywall's own email box, paid with the built-in purchase button.",
      wallets:
        "Only the wallet buttons, with no purchase button: the wallet pays and asks for the email itself.",
      billing:
        "An email field, Stripe's billing address form and its card form; the purchase also sends custom metadata.",
      promo:
        "An email field and Stripe's card form with a promotion code box: a valid code re-prices the form and the charge.",
    },
  },
  form: {
    or: "or pay with card",
    applePay: "Subscribe with Apple Pay",
    applePayPreparing: "Getting Apple Pay ready…",
    applePayUnavailable: "Apple Pay isn't available here: {message}",
    orWallet: "or pay in one tap",
    email: "Email",
    emailPlaceholder: "you@example.com",
    card: "Card",
    cardNumber: "Card number",
    expiry: "Expiry",
    cvc: "CVC",
    incomplete: "Fill in every field.",
    dueToday: "Due today",
    renews: "then {price} every {interval}",
  },
  promo: {
    label: "Promo code",
    apply: "Apply",
    applied: "{code} applied",
    remove: "Remove",
    invalid: "That code isn't valid.",
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
  events: {
    label: "Purchase events",
    empty: "Nothing yet. Start a purchase and its callbacks show up here.",
    clear: "Clear",
    paywall: "usePurchase",
    form: "StripeCheckout",
  },
  common: {
    close: "Close",
  },
  footer: {
    builtWith: "Built with",
    superwall: "Superwall",
  },
} as const;
