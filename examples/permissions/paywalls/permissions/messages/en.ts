export default {
  paywall: {
    title: "Permissions",
    subtitle: "Ask the app for something and wait for its answer.",
    close: "Close",
  },
  permissions: {
    notification: "Notifications",
    camera: "Camera",
    microphone: "Microphone",
    location: "Location",
    backgroundLocation: "Location, always",
    contacts: "Contacts",
    readImages: "Photos",
    readVideo: "Videos",
    tracking: "Tracking",
  },
  log: {
    label: "Answers",
    empty: "Nothing asked yet.",
  },
  status: {
    granted: "Granted",
    denied: "Denied",
    unsupported: "Unsupported",
    success: "Succeeded",
    failure: "Failed",
  },
  callbacks: {
    title: "Callbacks",
    lead: "A permission asks the OS. A callback asks ",
    emphasis: "your app",
    body: " — run some code, hand something back. Use it for anything the paywall cannot know: whether this account already exists, what the last workout was, whether a referral is valid.",
    run: "Run checkAccount",
    note: "Both return a promise the app resolves, so the paywall is waiting on code you do not control. Give it something to look at, and handle a no.",
  },
  footer: {
    builtWith: "Built with",
    superwall: "Superwall",
  },
} as const;
