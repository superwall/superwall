import { CLIENT_SCRIPT } from "@superwall/workspace-sdk/client-script";
import type { MetricRequest, MetricSeries } from "@superwall/workspace-sdk/metrics";
import {
  defineWorkspace,
  superwallFetch,
  type WorkspaceRequest,
} from "@superwall/workspace-sdk/server";
import type { OrgPageContextV1 } from "@superwall/workspace-sdk/slots";

const UNITS = { hour: "HOUR", day: "DAY", week: "WEEK", month: "MONTH" };
const dateTime = (iso: string) => iso.slice(0, 19).replace("T", " ");

// Charts calls this for the `transactions` entrypoint. Anything in manifest `filters` can reach SQL
// only as a parameter, and a bucket with no point draws as a gap, so return 0 where zero is what you mean.
const metric = async ({
  context,
  from,
  to,
  interval,
  breakdown,
  filters,
}: MetricRequest): Promise<MetricSeries> => {
  const search = new URLSearchParams({
    default_format: "JSON",
    param_app: String(context.applicationId),
    param_from: dateTime(from),
    param_to: dateTime(to),
  });
  let storeFilter = "";
  if (filters.store) {
    storeFilter = "AND store IN {stores:Array(String)}";
    search.set("param_stores", `[${filters.store.map((store) => `'${store}'`).join(",")}]`);
  }
  const sql = `
    SELECT toDateTime(toStartOfInterval(ts, INTERVAL 1 ${UNITS[interval]})) AS t,
           ${breakdown === "store" ? "store" : "NULL"} AS breakdown,
           uniq(transactionId) AS value
    FROM open_revenue.attributed_events_by_ts_rep
    WHERE applicationId = {app:UInt64} AND ts >= {from:DateTime} AND ts < {to:DateTime} AND ts < now()
      AND isSandbox = 0 ${storeFilter}
    GROUP BY t, breakdown
    ORDER BY t`;
  const response = await superwallFetch(
    `/v2/organizations/${context.organizationId}/query?${search}`,
    {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: sql,
    },
  );
  if (!response.ok) throw new Error((await response.text()).slice(0, 500));
  const { data } = (await response.json()) as {
    data: ReadonlyArray<{ t: string; value: string | number; breakdown: string | null }>;
  };
  return {
    points: data.map((row) => ({
      t: `${row.t.replace(" ", "T")}Z`,
      value: Number(row.value),
      breakdown: row.breakdown,
    })),
  };
};

const escape = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!,
  );

// A page is whatever its Worker answers. It calls Superwall as the person viewing it, with no credential of its own.
// /v2/projects needs projects:read in superwall.json; without it, this call answers 403.
// SQL (/v2/organizations/:id/query, data:read) works here and in a metric, and not in a slot tied to one app.
const home = async ({ context }: WorkspaceRequest) => {
  const { organizationId } = context as OrgPageContextV1;
  const response = await superwallFetch(`/v2/projects?organization_id=${organizationId}`);
  const projects = response.ok
    ? ((await response.json()) as { data: ReadonlyArray<{ name: string }> }).data
    : [];
  const rows = projects.map((project) => `<li>${escape(project.name)}</li>`).join("");
  return new Response(
    `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<title>My workspace</title>
<style>
  body { margin: 0; padding: 24px; font: 14px/1.5 system-ui, sans-serif; color: var(--foreground); background: var(--background); }
  h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
  p { margin: 0 0 16px; color: var(--muted-foreground); }
</style>
<h1>My workspace</h1>
<p>Edit src/worker.ts to change this page. Your projects:</p>
<ul>${rows || "<li>None you can see.</li>"}</ul>
<script>${CLIENT_SCRIPT}</script>
<script>
  // The dashboard sends its theme and this page's context over the bridge.
  const applyTheme = ({ tokens }) => {
    for (const [name, value] of Object.entries(tokens)) document.documentElement.style.setProperty("--" + name, value)
  }
  superwallWorkspace.connect().then((bridge) => {
    applyTheme(bridge.theme)
    bridge.onTheme(applyTheme)
  })
</script>
</html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
};

export default defineWorkspace({
  fetch: (request) => {
    if (new URL(request.request.url).pathname === "/") return home(request);
    return new Response("Not found", { status: 404 });
  },
  metric,
});
