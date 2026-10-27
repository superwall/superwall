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
