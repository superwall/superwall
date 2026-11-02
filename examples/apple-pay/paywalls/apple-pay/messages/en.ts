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
    applePay: "Pay with Apple Pay",
    restore: "Restore purchases",
    failed: "That didn't go through. Try again.",
  },
  wallet: {
    native: "Apple Pay: not offered in this app (undefined).",
    none: {
      unsupported_browser:
        "Apple Pay: this browser can't open the wallet itself (false, unsupported_browser).",
      insecure_context: "Apple Pay: the page isn't served over HTTPS (false, insecure_context).",
      device_unsupported:
        "Apple Pay: this device can't pay with Apple Pay (false, device_unsupported).",
      cross_origin_frame:
        "Apple Pay: blocked in a frame of another site (false, cross_origin_frame).",
      check_failed: "Apple Pay: the browser's check failed (false, check_failed).",
    },
    preparing: "Apple Pay: available (true), getting the wallet ready…",
    ready: "Apple Pay: available (true), the wallet opens on tap.",
    unavailable:
      "Apple Pay: available (true), but the wallet isn't ready ({reason}), so the card sheet opens.",
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
