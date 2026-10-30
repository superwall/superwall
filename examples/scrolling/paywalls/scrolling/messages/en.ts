export default {
  paywall: {
    title: "Everything in Pro",
    subtitle: "A page taller than the screen scrolls, and a row wider than it scrolls sideways.",
    highlights: "Highlights",
    highlightsHint: "Swipe sideways",
    features: "Every feature",
    faq: "Questions",
    cta: "Subscribe · {price}",
    ctaBare: "Subscribe",
    restore: "Restore purchases",
  },
  highlights: {
    projects: { title: "Unlimited projects", body: "No cap on what you make." },
    offline: { title: "Offline mode", body: "Everything works on a plane." },
    spaces: { title: "Shared spaces", body: "Invite a team, keep one source." },
    history: { title: "Version history", body: "Every change, a year back." },
    support: { title: "Priority support", body: "A person answers within a day." },
    themes: { title: "Custom themes", body: "Your colours, everywhere." },
  },
  features: {
    sync: "Sync across every device",
    export: "Export to PDF, PNG and SVG",
    folders: "Folders and tags",
    search: "Full-text search",
    reminders: "Reminders that repeat",
    widgets: "Widgets for the home screen",
    lock: "Face ID lock",
    shortcuts: "Keyboard shortcuts",
    dark: "Dark mode that follows the system",
    templates: "Templates for common layouts",
    comments: "Comments and mentions",
    links: "Read-only share links",
    backups: "Automatic backups",
    import: "Import from other apps",
  },
  faq: {
    cancel: {
      question: "Can I cancel any time?",
      answer: "Yes. Cancel in your store settings and Pro runs to the end of the period.",
    },
    devices: {
      question: "Does it work on every device?",
      answer: "One subscription covers every device signed in to your account.",
    },
    stop: {
      question: "What happens to my work if I stop?",
      answer: "It stays yours. Pro features lock; nothing is deleted.",
    },
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
