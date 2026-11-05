// Generated from packages/workspace-sdk by its vendor script. Do not edit.

// src/wire.ts
var CONTEXT_HEADER = "x-superwall-workspace-context";
var ENTRYPOINT_HEADER = "x-superwall-workspace-entrypoint";
var TRIGGER_HEADER = "x-superwall-workspace-trigger";
var API_HOST = "api.workspace.internal";

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
var defineWorkspace = (handlers) => ({
  fetch: (request) => handlers.fetch(readRequest(request)),
  ...handlers.metric === void 0 ? {} : { metric: handlers.metric },
  ...handlers.readout === void 0 ? {} : { readout: handlers.readout }
});
export {
  defineWorkspace,
  readRequest,
  superwallFetch
};
