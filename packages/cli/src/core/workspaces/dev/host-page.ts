import { BRIDGE_PROTOCOL, MOUNT_LOAD_TIMEOUT_MS } from "@/core/workspaces/wire";

const LIGHT_TOKENS = {
  background: "#ffffff",
  foreground: "#14151a",
  card: "#ffffff",
  "card-foreground": "#14151a",
  popover: "#ffffff",
  muted: "#f1f1f3",
  "muted-foreground": "#6b6d76",
  border: "#e4e4e8",
  primary: "#74f8f0",
  "primary-foreground": "#14151a",
  secondary: "#f1f1f3",
  "secondary-foreground": "#14151a",
  destructive: "#d92d20",
  success: "#12805c",
  warning: "#b54708",
  info: "#2563eb",
  "fg-secondary": "#44464f",
  "fg-tertiary": "#6b6d76",
  radius: "3px",
};

const DARK_TOKENS = {
  background: "#14151a",
  foreground: "#f4f4f6",
  card: "#1b1c22",
  "card-foreground": "#f4f4f6",
  popover: "#1b1c22",
  muted: "#25262d",
  "muted-foreground": "#9a9ca6",
  border: "#2e2f37",
  primary: "#74f8f0",
  "primary-foreground": "#14151a",
  secondary: "#25262d",
  "secondary-foreground": "#f4f4f6",
  destructive: "#f97066",
  success: "#47cd89",
  warning: "#fdb022",
  info: "#60a5fa",
  "fg-secondary": "#c9cad1",
  "fg-tertiary": "#9a9ca6",
  radius: "3px",
};

const STYLES = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; height: 100vh; display: grid; grid-template-columns: 280px 1fr; font: 13px/1.5 system-ui, sans-serif; background: var(--background); color: var(--foreground); }
aside { border-right: 1px solid var(--border); padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 16px; }
main { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100vh; }
h1 { font-size: 14px; font-weight: 600; margin: 0; }
h2 { font-size: 12px; font-weight: 500; color: var(--muted-foreground); margin: 0 0 6px; }
label { display: block; margin-bottom: 8px; color: var(--muted-foreground); }
input, select { display: block; width: 100%; margin-top: 2px; padding: 5px 6px; font: inherit; color: var(--foreground); background: var(--background); border: 1px solid var(--border); border-radius: var(--radius); }
button { padding: 5px 10px; font: inherit; color: var(--foreground); background: var(--muted); border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; }
.entry { display: block; width: 100%; text-align: left; margin-bottom: 4px; background: transparent; }
.entry[aria-current="true"] { background: var(--muted); }
.entry small { display: block; color: var(--muted-foreground); }
#stage { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
iframe { width: 100%; border: 0; display: block; background: var(--background); }
iframe.fills { flex: 1; min-height: 100%; }
.panel { padding: 16px; }
.problem { padding: 16px; color: var(--destructive); white-space: pre-wrap; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); }
th { font-weight: 500; color: var(--muted-foreground); }
svg { display: block; width: 100%; height: 160px; margin-bottom: 12px; }
#log { flex: none; height: 120px; overflow: auto; border-top: 1px solid var(--border); padding: 8px 16px; font: 12px/1.5 ui-monospace, monospace; color: var(--muted-foreground); }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.row label { margin-bottom: 0; }
.row h1 { flex: 1; }
`;

const SCRIPT = `
const PROTOCOL = ${JSON.stringify(BRIDGE_PROTOCOL)};
const LOAD_TIMEOUT_MS = ${MOUNT_LOAD_TIMEOUT_MS};
const TOKENS = { light: ${JSON.stringify(LIGHT_TOKENS)}, dark: ${JSON.stringify(DARK_TOKENS)} };
const FIELD_LABELS = {
  organizationId: "Organization id", applicationId: "App id", environment: "Environment", from: "From", to: "To",
  campaignId: "Campaign id", audienceId: "Audience id", variantIds: "Variant ids, comma separated",
  appUserId: "App user id", aliases: "Aliases, comma separated",
};
const el = (tag, attributes = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
    else if (value !== undefined && value !== null) node.setAttribute(name, value);
  }
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
};
const $ = (id) => document.getElementById(id);
const post = async (path, body) => {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const answer = await response.json();
  if (!response.ok) throw new Error(answer.error ?? "Something went wrong.");
  return answer;
};
const log = (text) => {
  const line = el("div", {}, new Date().toLocaleTimeString() + "  " + text);
  $("log").append(line);
  line.scrollIntoView({ block: "nearest" });
};

let state;
let selected;
let mode = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
let values = {};
let frame = null;
let mount = null;

const theme = () => ({ mode, tokens: TOKENS[mode] });
const applyTheme = () => {
  for (const [name, value] of Object.entries(TOKENS[mode])) document.documentElement.style.setProperty("--" + name, value);
  document.documentElement.style.colorScheme = mode;
};
const hostMessage = (body) => ({ ...body, protocol: PROTOCOL, nonce: mount.nonce });
const send = (body) => {
  if (mount?.connected) frame?.contentWindow?.postMessage(hostMessage(body), mount.origin);
};
const fieldsOf = (slot) => {
  const fields = state.slots[slot]?.fields ?? [];
  return fields.flatMap((field) => (field === "dateRange" ? ["from", "to"] : [field]));
};
const inputFromForm = () => {
  const input = { ...values };
  for (const key of ["variantIds", "aliases"]) {
    if (typeof input[key] === "string") input[key] = input[key].split(",").map((value) => value.trim()).filter(Boolean);
  }
  return input;
};
const renderContext = (slot) => {
  const box = $("context");
  box.replaceChildren(el("h2", {}, "Context"));
  for (const field of fieldsOf(slot)) {
    const control = field === "environment"
      ? el("select", { onchange: (event) => { values[field] = event.target.value; } }, ...["PRODUCTION", "SANDBOX"].map((value) => el("option", value === (values[field] ?? "PRODUCTION") ? { selected: "" } : {}, value)))
      : el("input", { value: Array.isArray(values[field]) ? values[field].join(", ") : values[field] ?? "", oninput: (event) => { values[field] = event.target.value; } });
    box.append(el("label", {}, FIELD_LABELS[field] ?? field, control));
  }
  box.append(el("button", { onclick: () => show() }, "Apply"));
};
const fail = (message) => {
  frame = null;
  mount = null;
  $("stage").replaceChildren(el("div", { class: "problem" }, message));
};

const showFrame = async (entrypoint) => {
  const session = await post("/__dev/sessions", { entrypoint: entrypoint.id, input: inputFromForm() });
  const slot = state.slots[session.slot];
  const fills = slot.shape === "page" || session.slot === "app.dashboard.widget@1";
  const nonce = crypto.randomUUID().replaceAll("-", "");
  mount = { nonce, origin: session.origin, connected: false, slot, ready: false, timer: 0 };
  frame = el("iframe", {
    class: fills ? "fills" : undefined,
    title: entrypoint.title,
    sandbox: "allow-scripts allow-same-origin allow-forms allow-popups",
    src: session.connect_url,
    onload: () => {
      mount.connected = true;
      frame.contentWindow.postMessage(hostMessage({ _tag: "connect", theme: theme(), context: session.context }), mount.origin);
      clearTimeout(mount.timer);
      mount.timer = setTimeout(() => {
        if (!mount.ready) log("It didn't send ready within " + LOAD_TIMEOUT_MS / 1000 + " seconds. In the dashboard this shows as: This app couldn't load. Try again.");
      }, LOAD_TIMEOUT_MS);
    },
  });
  if (!fills && slot.minHeight) frame.style.height = slot.minHeight + "px";
  $("stage").replaceChildren(frame);
};

window.addEventListener("message", (event) => {
  if (!mount || !frame || event.source !== frame.contentWindow || event.origin !== mount.origin) return;
  const message = event.data;
  if (message?.protocol !== PROTOCOL || message.nonce !== mount.nonce) return;
  if (message._tag === "ready") {
    mount.ready = true;
    log("ready");
    send({ _tag: "visibility", visible: true });
  } else if (message._tag === "resize") {
    const { minHeight, maxHeight, shape } = mount.slot;
    if (shape === "page" || maxHeight === null) return;
    const height = Math.min(maxHeight, Math.max(minHeight, Math.round(message.height)));
    if (!frame.classList.contains("fills")) frame.style.height = height + "px";
  } else if (message._tag === "error") {
    fail("It reported: " + message.message);
  } else {
    log(message._tag + " " + JSON.stringify({ ...message, _tag: undefined, protocol: undefined, nonce: undefined }));
  }
});

const chart = (points) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (points.length === 0) return svg;
  const series = new Map();
  for (const point of points) {
    const name = point.breakdown ?? "All";
    series.set(name, [...(series.get(name) ?? []), point]);
  }
  const times = points.map((point) => Date.parse(point.t));
  const [minT, maxT] = [Math.min(...times), Math.max(...times)];
  const maxV = Math.max(...points.map((point) => point.value), 0) || 1;
  svg.setAttribute("viewBox", "0 0 1000 160");
  svg.setAttribute("preserveAspectRatio", "none");
  const colors = ["#2563eb", "#12805c", "#b54708", "#7c3aed", "#d92d20", "#0891b2"];
  [...series.values()].forEach((list, index) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    const sorted = [...list].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    path.setAttribute("points", sorted.map((point) => {
      const x = maxT === minT ? 500 : ((Date.parse(point.t) - minT) / (maxT - minT)) * 1000;
      return x + "," + (155 - (point.value / maxV) * 150);
    }).join(" "));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", colors[index % colors.length]);
    path.setAttribute("stroke-width", "2");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    svg.append(path);
  });
  return svg;
};

const showMetric = (entrypoint) => {
  const definition = entrypoint.metric ?? {};
  const query = { from: values.from ?? "", to: values.to ?? "", interval: "day", breakdown: "", filters: {} };
  const out = el("div", {});
  const run = async () => {
    out.replaceChildren(el("p", {}, "Running..."));
    try {
      const { series, took_ms } = await post("/__dev/metric", {
        entrypoint: entrypoint.id,
        input: inputFromForm(),
        from: query.from || undefined,
        to: query.to || undefined,
        interval: query.interval,
        breakdown: query.breakdown || null,
        filters: query.filters,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      const rows = series.points.slice(0, 500).map((point) => el("tr", {}, el("td", {}, point.t), el("td", {}, point.breakdown ?? ""), el("td", {}, String(point.value))));
      out.replaceChildren(
        el("p", {}, series.points.length + " points in " + took_ms + " ms"),
        chart(series.points),
        el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Bucket"), el("th", {}, "Breakdown"), el("th", {}, "Value"))), el("tbody", {}, ...rows)),
      );
    } catch (error) {
      out.replaceChildren(el("div", { class: "problem" }, error.message));
    }
  };
  const breakdowns = el("select", { onchange: (event) => { query.breakdown = event.target.value; } }, el("option", { value: "" }, "None"), ...(definition.breakdowns ?? []).map((item) => el("option", { value: item.key }, item.name)));
  const filters = (definition.filters ?? []).map((filter) =>
    el("label", {}, filter.name, el("select", { onchange: (event) => { query.filters[filter.key] = event.target.value ? [event.target.value] : []; } }, el("option", { value: "" }, "All"), ...filter.values.map((option) => el("option", { value: option.value }, option.label)))),
  );
  const form = el("div", { class: "row" },
    el("label", {}, "From", el("input", { placeholder: "30 days ago", oninput: (event) => { query.from = event.target.value; } })),
    el("label", {}, "To", el("input", { placeholder: "Now", oninput: (event) => { query.to = event.target.value; } })),
    el("label", {}, "Interval", el("select", { onchange: (event) => { query.interval = event.target.value; } }, ...["day", "hour", "week", "month"].map((value) => el("option", {}, value)))),
    el("label", {}, "Breakdown", breakdowns),
    ...filters,
    el("button", { onclick: run }, "Run"),
  );
  $("stage").replaceChildren(el("div", { class: "panel" }, el("h1", {}, entrypoint.title), el("p", {}, definition.description ?? ""), form, out));
  frame = null;
  mount = null;
  if (values.applicationId) run();
};

const showReadout = (entrypoint) => {
  const out = el("div", {});
  const run = async () => {
    try {
      const { result, took_ms } = await post("/__dev/readout", { entrypoint: entrypoint.id, input: inputFromForm() });
      const rows = result.variants.map((variant) => el("tr", {}, el("td", {}, String(variant.variantId)), el("td", {}, String(variant.value)), el("td", {}, variant.interval ? variant.interval.join(" to ") : "")));
      out.replaceChildren(el("p", {}, took_ms + " ms"), el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Variant"), el("th", {}, "Value"), el("th", {}, "Interval"))), el("tbody", {}, ...rows)));
    } catch (error) {
      out.replaceChildren(el("div", { class: "problem" }, error.message));
    }
  };
  $("stage").replaceChildren(el("div", { class: "panel" }, el("h1", {}, entrypoint.title), el("button", { onclick: run }, "Run"), out));
  frame = null;
  mount = null;
};

const show = async () => {
  const entrypoint = state.manifest.entrypoints.find((candidate) => candidate.id === selected);
  if (!entrypoint) return;
  try {
    if (entrypoint.slot === "chart.source@1") showMetric(entrypoint);
    else if (entrypoint.slot === "campaign.metric@1") showReadout(entrypoint);
    else await showFrame(entrypoint);
  } catch (error) {
    fail(error.message);
  }
};
const select = (id) => {
  selected = id;
  const entrypoint = state.manifest.entrypoints.find((candidate) => candidate.id === id);
  for (const button of document.querySelectorAll(".entry")) button.setAttribute("aria-current", String(button.dataset.id === id));
  renderContext(entrypoint.slot);
  history.replaceState(null, "", "#" + id);
  show();
};
const renderEntrypoints = () => {
  const box = $("entrypoints");
  box.replaceChildren(el("h2", {}, "Entrypoints"));
  for (const entrypoint of state.manifest.entrypoints) {
    const button = el("button", { class: "entry", onclick: () => select(entrypoint.id) }, entrypoint.title, el("small", {}, entrypoint.slot));
    button.dataset.id = entrypoint.id;
    box.append(button);
  }
};
const load = async () => {
  state = await (await fetch("/__dev/state")).json();
  values = { ...state.defaults, ...values };
  $("title").textContent = state.manifest.name;
  renderEntrypoints();
  const wanted = location.hash.slice(1);
  const first = state.manifest.entrypoints.find((candidate) => candidate.id === wanted) ?? state.manifest.entrypoints[0];
  if (first) select(first.id);
};

$("theme").addEventListener("click", () => {
  mode = mode === "dark" ? "light" : "dark";
  applyTheme();
  send({ _tag: "theme", theme: theme() });
});
const events = new EventSource("/__dev/events");
events.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "error") {
    log(message.message);
    fail(message.message);
  } else {
    log("Rebuilt");
    load();
  }
};
applyTheme();
load();
`;

export function renderHostPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Workspace dev</title>
<style>${STYLES}</style>
</head>
<body>
<aside>
  <div class="row"><h1 id="title">Workspace</h1><button id="theme">Theme</button></div>
  <div id="entrypoints"></div>
  <div id="context"></div>
</aside>
<main>
  <div id="stage"></div>
  <div id="log" aria-label="Log"></div>
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}
