export default {
  paywall: {
    title: "Purchase states",
    subtitle: "Get the outcome of a purchase and act on it. Pick the result in the studio.",
    cta: "Subscribe · {price}",
    ctaBare: "Subscribe",
    restore: "Restore purchases",
    close: "Close",
    failed: "The purchase didn't go through. Try again.",
  },
  log: {
    empty: "Nothing yet.",
    purchased: "Bought or restored.",
    abandoned: "Closed the sheet.",
    trialStarted: "Trial started.",
    resolved: "What the call resolved with.",
    restored: "Restored.",
    nothingToRestore: "Nothing to restore, or the store didn't answer.",
  },
  failure: {
    card_declined: "Your card was declined. Try another card.",
    insufficient_funds: "Your card doesn't have enough funds. Try another card.",
    expired_card: "Your card has expired. Try another card.",
    incorrect_card_details: "Check your card details and try again.",
    authentication_failed: "Your bank couldn't confirm the payment. Try again.",
    card_not_supported: "This card isn't supported. Try another card.",
    limit_exceeded: "Your card's limit was reached. Try another card.",
    fraud_suspected: "Your bank declined this payment. Try another card.",
    processing_error: "The payment couldn't be processed. Try again.",
    unknown: "The payment didn't go through. Try again.",
  },
  note: {
    and: " and ",
    resolve:
      " each resolve with the outcome of that call. Events fire for anything the SDK reports — a restore announces itself as ",
    never: ", never ",
    end: ".",
  },
  footer: {
    builtWith: "Built with",
    superwall: "Superwall",
  },
} as const;
