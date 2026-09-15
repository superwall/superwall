export default {
  index: {
    title: "Transitions",
    subtitle:
      "Multi-page paywalls move between pages with a transition. Five are built in, and you can define your own in CSS.",
  },
  choices: {
    push: { name: "Push", tag: "Default", blurb: "The native iOS push." },
    slide: { name: "Slide", blurb: "Both pages travel together." },
    fade: { name: "Fade", blurb: "The new page fades in over the old one." },
    shift: {
      name: "Shift",
      tag: "Funnels",
      blurb: "The new page fades in as it drifts into place.",
    },
    none: { name: "None", blurb: "No animation at all." },
    zoom: { name: "Custom", blurb: "Any CSS animation you write yourself." },
  },
  pages: {
    push: {
      title: "Push",
      body: "The native iOS push. Best for drilling into a detail, because back feels like returning.",
    },
    slide: {
      title: "Slide",
      body: "Both pages travel together. Best for steps of equal weight, like an onboarding flow.",
    },
    fade: {
      title: "Fade",
      body: "The new page fades in over the old one, a little quicker than the others.",
    },
    shift: {
      title: "Shift",
      body: "The funnel step. The new page fades in as it drifts into place; the old one is simply gone. One layer moves at a time, so a long flow never feels like a stack.",
    },
    none: {
      title: "None",
      body: "Transitions without any animations.",
    },
    zoom: {
      title: "Custom",
      body: "This one is a page zoom, written in CSS by this example.",
      detail:
        "Allows any custom CSS animation you write. We expose enter, recede, return and leave, so you control how pages enter and exit in both directions.",
    },
  },
  common: {
    back: "Back",
    close: "Close",
  },
  footer: {
    builtWith: "Built with",
    superwall: "Superwall",
  },
} as const;
