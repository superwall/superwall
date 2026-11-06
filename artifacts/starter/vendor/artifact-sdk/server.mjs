// Generated from packages/artifact-sdk by its vendor script. Do not edit.

// src/wire.ts
var CONTEXT_HEADER = "x-superwall-artifact-context";
var ENTRYPOINT_HEADER = "x-superwall-artifact-entrypoint";
var TRIGGER_HEADER = "x-superwall-artifact-trigger";
var API_HOST = "api.artifact.internal";
var CLIENT_BUNDLE_MAX_BYTES = 8 * 1024 * 1024;

// src/server.ts
var TRIGGERS = /* @__PURE__ */ new Set(["view", "metric", "cron", "event", "job", "dev"]);
var readRequest = (request) => {
  const rawContext = request.headers.get(CONTEXT_HEADER);
  const rawTrigger = request.headers.get(TRIGGER_HEADER) ?? "view";
  return {
    request,
    entrypoint: request.headers.get(ENTRYPOINT_HEADER),
    trigger: TRIGGERS.has(rawTrigger) ? rawTrigger : "view",
    context: rawContext === null ? null : JSON.parse(rawContext)
  };
};
var superwallFetch = (path, init) => {
  if (!path.startsWith("/")) throw new Error("superwallFetch takes an absolute API path");
  return fetch(`https://${API_HOST}${path}`, init);
};
var IMMUTABLE = "private, max-age=31536000, immutable";
var asset = (text, contentType) => new Response(text, {
  headers: { "content-type": contentType, "cache-control": IMMUTABLE }
});
var serveClientAsset = (client, request) => {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const { pathname } = new URL(request.url);
  if (pathname === client.scriptPath) return asset(client.script, "text/javascript; charset=utf-8");
  if (client.style !== null && pathname === client.stylePath) {
    return asset(client.style, "text/css; charset=utf-8");
  }
  return null;
};
var escapeHtml = (text) => text.replace(
  /[&<>"']/g,
  (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char
);
var clientPage = (client, options = {}) => {
  const headers = new Headers(options.headers);
  if (!headers.has("content-type")) headers.set("content-type", "text/html; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-cache");
  const title = options.title === void 0 ? "" : `<title>${escapeHtml(options.title)}</title>`;
  const style = client.stylePath === null ? "" : `<link rel="stylesheet" href="${client.stylePath}">`;
  return new Response(
    `<!doctype html>
<html lang="${escapeHtml(options.lang ?? "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${title}${style}${options.head ?? ""}
</head>
<body>
${options.body ?? '<div id="root"></div>'}
<script type="module" src="${client.scriptPath}"></script>
</body>
</html>
`,
    { headers }
  );
};
var defineArtifact = (handlers) => ({
  fetch: (request) => (handlers.client === void 0 ? null : serveClientAsset(handlers.client, request)) ?? handlers.fetch(readRequest(request)),
  ...handlers.metric === void 0 ? {} : { metric: handlers.metric },
  ...handlers.readout === void 0 ? {} : { readout: handlers.readout }
});
export {
  clientPage,
  defineArtifact,
  readRequest,
  serveClientAsset,
  superwallFetch
};
