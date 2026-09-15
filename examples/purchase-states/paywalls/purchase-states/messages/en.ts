export default {
  paywall: {
    title: "Purchase states",
    subtitle: "Get the outcome of a purchase and act on it. Pick the result in the studio.",
    cta: "Subscribe · {price}",
    ctaBare: "Subscribe",
    restore: "Restore purchases",
    close: "Close",
  },
  log: {
    empty: "Nothing yet.",
    purchased: "Bought or restored.",
    abandoned: "Closed the sheet.",
    trialStarted: "Trial started.",
    resolved: "What the call resolved with.",
    restored: "Restored.",
    nothingToRestore: "Nothing to restore.",
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
