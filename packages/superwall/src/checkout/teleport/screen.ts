import { FOOTER_BRAND, STATUS_MARKS, SUPERWALL_LOGO_PATHS, TELEPORT_SCREEN_CSS } from "./styles";

const STYLE_ID = "sw-teleport-style";
const EXIT_MS = 200;
const SPINNER_RADIUS = 14;
const SPINNER_CIRCUMFERENCE = 2 * Math.PI * SPINNER_RADIUS;
const SVG_NS = "http://www.w3.org/2000/svg";

export type TeleportScreenAction = {
  label: string;
  kind: "primary" | "tinted" | "secondary";
  href?: string;
  onClick: () => void;
};

export type TeleportScreenOptions = {
  surface: "overlay" | "page";
  role: "dialog" | "status";
  title: string;
  body: string;
  dir?: "ltr" | "rtl";
  spinner?: boolean;
  status?: keyof typeof STATUS_MARKS;
  footer?: { label: string; href: string };
  actions: readonly TeleportScreenAction[];
  instant?: boolean;
};

export type TeleportScreen = {
  readonly root: HTMLElement;
  remove(options?: { instant?: boolean }): void;
};

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const svgElement = (tag: string, attributes: Record<string, string>): Element => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
};

const ring = ({ className, arcLength }: { className?: string; arcLength?: number }): Element => {
  const svg = svgElement("svg", {
    viewBox: "0 0 32 32",
    "aria-hidden": "true",
    ...(className === undefined ? {} : { class: className }),
  });
  svg.append(
    svgElement("circle", {
      cx: "16",
      cy: "16",
      r: String(SPINNER_RADIUS),
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2.5",
      "stroke-linecap": "round",
      ...(arcLength === undefined
        ? {}
        : { "stroke-dasharray": `${arcLength} ${SPINNER_CIRCUMFERENCE}` }),
    }),
  );
  return svg;
};

const spinner = (label: string): HTMLElement => {
  const node = element("div", "sw-teleport-spinner");
  node.setAttribute("role", "progressbar");
  node.setAttribute("aria-label", label);
  const orbit = element("div", "sw-teleport-orbit");
  const arc = element("div", "sw-teleport-arc");
  arc.append(ring({ arcLength: SPINNER_CIRCUMFERENCE * 0.28 }));
  orbit.append(arc);
  node.append(ring({ className: "sw-teleport-track" }), orbit);
  return node;
};

const statusIcon = (status: keyof typeof STATUS_MARKS): HTMLElement => {
  const node = element("div", "sw-teleport-status");
  node.dataset.status = status;
  const svg = svgElement("svg", {
    viewBox: "0 0 32 32",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  svg.append(
    svgElement("circle", {
      class: "sw-teleport-status-ring",
      cx: "16",
      cy: "16",
      r: String(SPINNER_RADIUS),
      transform: "rotate(-90 16 16)",
    }),
    ...STATUS_MARKS[status].map((d) =>
      svgElement("path", { class: "sw-teleport-status-mark", d, pathLength: "1" }),
    ),
  );
  node.append(svg);
  return node;
};

const footer = ({ label, href }: { label: string; href: string }): HTMLElement => {
  const link = element("a", "sw-teleport-footer");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  const logo = svgElement("svg", { viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" });
  for (const [letter, d] of Object.entries(SUPERWALL_LOGO_PATHS)) {
    logo.append(
      svgElement("path", { class: `sw-teleport-footer-logo-${letter}`, d, fill: "currentColor" }),
    );
  }
  const text = element("span", "sw-teleport-footer-text");
  const [before = "", ...after] = label.split(FOOTER_BRAND);
  if (after.length === 0) text.textContent = label;
  else {
    text.append(
      before,
      element("span", "sw-teleport-footer-brand", FOOTER_BRAND),
      after.join(FOOTER_BRAND),
    );
  }
  link.append(logo, text);
  return link;
};

const ensureStyle = () => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = TELEPORT_SCREEN_CSS;
  document.head.append(style);
};

const scrollsInside = (root: HTMLElement, target: EventTarget | null): boolean =>
  root.hasAttribute("data-overflow") &&
  target instanceof Element &&
  target.closest(".sw-teleport-message") !== null;

const blockBackground = (root: HTMLElement): (() => void) => {
  const html = document.documentElement;
  const previousOverflow = html.style.overflow;
  const previousOverscroll = html.style.overscrollBehavior;
  html.style.overflow = "hidden";
  html.style.overscrollBehavior = "none";
  const stopScroll = (event: Event) => {
    if (!scrollsInside(root, event.target)) event.preventDefault();
  };
  root.addEventListener("touchmove", stopScroll, { passive: false });
  root.addEventListener("wheel", stopScroll, { passive: false });
  const made: Element[] = [];
  for (const sibling of Array.from(document.body.children)) {
    if (sibling === root || sibling.hasAttribute("inert")) continue;
    sibling.setAttribute("inert", "");
    made.push(sibling);
  }
  return () => {
    html.style.overflow = previousOverflow;
    html.style.overscrollBehavior = previousOverscroll;
    root.removeEventListener("touchmove", stopScroll);
    root.removeEventListener("wheel", stopScroll);
    for (const sibling of made) sibling.removeAttribute("inert");
  };
};

export const poweredByHref = (): string => {
  const url = new URL("https://superwall.com/");
  url.searchParams.set("ref", "teleport");
  const subdomain = window.location.hostname.split(".")[0];
  if (subdomain) url.searchParams.set("utm_source", subdomain);
  return url.toString();
};

export const createTeleportScreen = (options: TeleportScreenOptions): TeleportScreen => {
  ensureStyle();

  const root = element("div", "sw-teleport");
  root.dataset.surface = options.surface;
  root.dir = options.dir ?? "ltr";
  root.setAttribute("role", options.role);
  if (options.role === "dialog") root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", options.title);

  const content = element("div", "sw-teleport-content");
  const message = element("div", "sw-teleport-message");
  if (options.spinner) message.append(spinner(options.title));
  if (options.status !== undefined) message.append(statusIcon(options.status));
  message.append(
    element("h1", "sw-teleport-title", options.title),
    element("p", "sw-teleport-body", options.body),
  );
  content.append(message);
  if (options.actions.length > 0) {
    const actions = element("div", "sw-teleport-actions");
    for (const action of options.actions) {
      const className = `sw-teleport-button sw-teleport-${action.kind}`;
      const button =
        action.href === undefined
          ? Object.assign(element("button", className, action.label), { type: "button" })
          : Object.assign(element("a", className, action.label), { href: action.href });
      button.addEventListener("click", action.onClick);
      actions.append(button);
    }
    content.append(actions);
  }
  root.append(content);
  if (options.footer !== undefined) {
    root.append(footer(options.footer));
    root.dataset.footer = "";
  }

  root.dataset.state = "closed";
  if (options.instant) root.dataset.instant = "";
  document.body.append(root);
  const unblock = blockBackground(root);

  const measure = () => {
    root.removeAttribute("data-overflow");
    root.toggleAttribute("data-overflow", root.scrollHeight > root.clientHeight + 1);
  };
  measure();
  window.addEventListener("resize", measure);

  void root.offsetWidth;
  root.dataset.state = "open";
  root.tabIndex = -1;
  root.focus({ preventScroll: true });

  let removed = false;
  return {
    root,
    remove: ({ instant = false } = {}) => {
      if (removed) return;
      removed = true;
      root.removeAttribute("data-instant");
      window.removeEventListener("resize", measure);
      unblock();
      if (instant) {
        root.remove();
        return;
      }
      root.removeAttribute("role");
      root.dataset.state = "closing";
      root.style.pointerEvents = "none";
      const detach = () => root.remove();
      root.addEventListener("transitionend", (event) => event.target === root && detach(), {
        once: true,
      });
      setTimeout(detach, EXIT_MS + 50);
    },
  };
};

export type ReturnDim = {
  readonly root: HTMLElement;
  showHint(caption: string, dir: "ltr" | "rtl"): void;
  remove(): void;
};

export type PromptView = {
  userAgent: string;
  language: string;
  innerWidth: number;
  innerHeight: number;
  screenWidth: number;
  screenHeight: number;
};

const OPEN_CENTER_INSET = 61.5;
const WIDEST_PHONE = 500;
const CLASSIC_OPEN_BOTTOM_BELOW_CENTER = 38.5;
const COMPACT_ALERT_OPEN_BOTTOM_BELOW_CENTER = 35.3;
const FIRST_ROOMY_ALERT_SAFARI = 18;
const GLASS_OPEN_BOTTOM_BELOW_SCREEN_CENTER = 20.7;
const GLASS_BOTTOM_BAR = 98;
const FIRST_GLASS_SAFARI = 26;
const ALERT_BOTTOM_BELOW_OPEN = 10;
const HINT_GAP = 14;
const ARROW_RISE = 56;
const ARROW_SWEEP = 52;
const ARROW_HEAD = 10;
const ARROW_HEAD_ANGLE = Math.PI / 4;
const ARROW_STROKE = 3;
const CAPTION_MARGIN = 24;

const RTL_SYSTEM_LANGUAGES = new Set<string | undefined>(["ar", "he", "fa", "ur"]);

const OTHER_IOS_BROWSERS = /\b(CriOS|FxiOS|EdgiOS|OPiOS|OPT|GSA|DuckDuckGo|Brave|YaBrowser|Arc)\//;

export const promptsLikeSafari = (userAgent: string): boolean =>
  !OTHER_IOS_BROWSERS.test(userAgent);

const safariMajor = (userAgent: string): number | undefined => {
  const match = /Version\/(\d+)/.exec(userAgent);
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

export const openButtonAnchor = (
  view: PromptView,
): { x: number; y: number; side: "ltr" | "rtl" } | undefined => {
  if (view.screenWidth > WIDEST_PHONE || view.innerWidth > view.innerHeight) return undefined;
  const [language] = view.language.toLowerCase().split("-");
  const side = RTL_SYSTEM_LANGUAGES.has(language) ? "rtl" : "ltr";
  const x = side === "rtl" ? OPEN_CENTER_INSET : view.innerWidth - OPEN_CENTER_INSET;
  const major = safariMajor(view.userAgent);
  if (major !== undefined && major < FIRST_GLASS_SAFARI) {
    const below =
      major < FIRST_ROOMY_ALERT_SAFARI
        ? COMPACT_ALERT_OPEN_BOTTOM_BELOW_CENTER
        : CLASSIC_OPEN_BOTTOM_BELOW_CENTER;
    return { x, y: view.innerHeight / 2 + below, side };
  }
  const top =
    view.innerHeight >= view.screenHeight
      ? 0
      : Math.max(0, view.screenHeight - view.innerHeight - GLASS_BOTTOM_BAR);
  return { x, y: view.screenHeight / 2 + GLASS_OPEN_BOTTOM_BELOW_SCREEN_CENTER - top, side };
};

const currentView = (): PromptView => ({
  userAgent: navigator.userAgent,
  language: navigator.language,
  innerWidth: window.innerWidth,
  innerHeight: window.innerHeight,
  screenWidth: window.screen.width,
  screenHeight: window.screen.height,
});

export type HintLayout = {
  tipX: number;
  tipY: number;
  tailX: number;
  tailY: number;
  captionLeft: number;
  captionWidth: number;
  captionAlign: "left" | "right";
};

export const hintLayout = (
  anchor: { x: number; y: number; side: "ltr" | "rtl" },
  width: number,
): HintLayout => {
  const cap = ARROW_STROKE / 2;
  const tipY = anchor.y + ALERT_BOTTOM_BELOW_OPEN + HINT_GAP + cap;
  const tailY = tipY + ARROW_RISE;
  if (anchor.side === "rtl") {
    const tailX = anchor.x + ARROW_SWEEP;
    const captionLeft = tailX + cap + HINT_GAP;
    return {
      tipX: anchor.x,
      tipY,
      tailX,
      tailY,
      captionLeft,
      captionWidth: Math.max(0, width - CAPTION_MARGIN - captionLeft),
      captionAlign: "left",
    };
  }
  const tailX = anchor.x - ARROW_SWEEP;
  return {
    tipX: anchor.x,
    tipY,
    tailX,
    tailY,
    captionLeft: CAPTION_MARGIN,
    captionWidth: Math.max(0, tailX - cap - HINT_GAP - CAPTION_MARGIN),
    captionAlign: "right",
  };
};

const round = (value: number) => Math.round(value * 10) / 10;

export const arrowPaths = (layout: HintLayout): [string, string] => {
  const { tipX, tipY, tailX, tailY } = layout;
  const barb = (turn: number) =>
    `${round(tipX + ARROW_HEAD * Math.cos(Math.PI / 2 + turn))} ${round(tipY + ARROW_HEAD * Math.sin(Math.PI / 2 + turn))}`;
  return [
    `M${round(tailX)} ${round(tailY)}Q${round(tipX)} ${round(tailY)} ${round(tipX)} ${round(tipY)}`,
    `M${barb(-ARROW_HEAD_ANGLE)}L${round(tipX)} ${round(tipY)}L${barb(ARROW_HEAD_ANGLE)}`,
  ];
};

const hintArrow = (paths: [string, string]): Element => {
  const svg = svgElement("svg", { class: "sw-teleport-dim-arrow", "aria-hidden": "true" });
  for (const d of paths) {
    svg.append(
      svgElement("path", {
        d,
        fill: "none",
        stroke: "currentColor",
        "stroke-width": String(ARROW_STROKE),
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    );
  }
  return svg;
};

export const createReturnDim = (): ReturnDim => {
  ensureStyle();
  const root = element("div", "sw-teleport-dim");
  root.setAttribute("aria-hidden", "true");
  root.dataset.state = "closed";
  document.body.append(root);
  void root.offsetWidth;
  root.dataset.state = "open";

  let removed = false;
  return {
    root,
    showHint: (caption, dir) => {
      if (removed || root.querySelector(".sw-teleport-dim-hint")) return;
      const anchor = openButtonAnchor(currentView());
      if (anchor === undefined) return;
      const hint = element("div", "sw-teleport-dim-hint");
      hint.dir = dir;
      const layout = hintLayout(anchor, window.innerWidth);
      hint.dataset.side = anchor.side;
      const text = element("p", "sw-teleport-dim-caption", caption);
      text.style.top = `${layout.tailY}px`;
      text.style.left = `${layout.captionLeft}px`;
      text.style.width = `${layout.captionWidth}px`;
      text.style.textAlign = layout.captionAlign;
      hint.append(hintArrow(arrowPaths(layout)), text);
      root.append(hint);
    },
    remove: () => {
      if (removed) return;
      removed = true;
      root.dataset.state = "closing";
      const detach = () => root.remove();
      root.addEventListener("transitionend", (event) => {
        if (event.target === root) detach();
      });
      setTimeout(detach, EXIT_MS + 50);
    },
  };
};
