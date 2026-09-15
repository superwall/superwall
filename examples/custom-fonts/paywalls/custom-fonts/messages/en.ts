export default {
  paywall: {
    title: "Custom fonts",
    subtitle:
      "Use any typeface you like. The file lives in this project and the build takes care of serving it.",
    headline: {
      key: "headline & body",
      value: "Manrope, from assets/",
    },
    mono: {
      key: "mono",
      value: "Roboto Mono, from a stylesheet",
    },
    note: {
      before: "Drop any font in",
      between: "and point an",
      after:
        "at it. The build uploads it to our CDN and rewrites the URL for you — nothing to host, nothing to configure.",
    },
  },
  common: {
    close: "Close",
  },
  footer: {
    builtWith: "Built with",
    superwall: "Superwall",
  },
} as const;
