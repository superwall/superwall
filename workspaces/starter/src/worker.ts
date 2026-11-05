import client from "@superwall/workspace-sdk/client-bundle";
import type { MetricRequest, MetricSeries } from "@superwall/workspace-sdk/metrics";
import {
  clientPage,
  defineWorkspace,
  superwallFetch,
  type WorkspaceRequest,
} from "@superwall/workspace-sdk/server";
import type { OrgPageContextV1 } from "@superwall/workspace-sdk/slots";

const UNITS = { hour: "HOUR", day: "DAY", week: "WEEK", month: "MONTH" };
const dateTime = (iso: string) => iso.slice(0, 19).replace("T", " ");

// Charts calls this for the `transactions` entrypoint. Anything in manifest `filters` can reach SQL
// only as a parameter. Buckets follow the chart's timezone, and WITH FILL returns 0 for a bucket with no
// transactions, because a bucket with no point draws as a gap. A window with none at all returns no points.
const metric = async ({
  context,
  from,
  to,
  interval,
  timezone,
  breakdown,
  filters,
}: MetricRequest): Promise<MetricSeries> => {
  const search = new URLSearchParams({
    default_format: "JSON",
    param_app: String(context.applicationId),
    param_from: dateTime(from),
    param_to: dateTime(to),
    param_tz: timezone,
  });
  let storeFilter = "";
  if (filters.store) {
    storeFilter = "AND store IN {stores:Array(String)}";
    search.set("param_stores", `[${filters.store.map((store) => `'${store}'`).join(",")}]`);
  }
  const unit = UNITS[interval];
  const bucketOf = (time: string) =>
    `toDateTime(toStartOfInterval(${time}, INTERVAL 1 ${unit}, {tz:String}), {tz:String})`;
  const sql = `
    SELECT toString(toTimeZone(bucket, 'UTC')) AS t, breakdown, value
    FROM (
      SELECT ${bucketOf("ts")} AS bucket,
             ${breakdown === "store" ? "store" : "NULL"} AS breakdown,
             uniq(transactionId) AS value
      FROM open_revenue.attributed_events_by_ts_rep
      WHERE applicationId = {app:UInt64} AND ts >= {from:DateTime} AND ts < {to:DateTime} AND ts < now()
        AND isSandbox = 0 ${storeFilter}
      GROUP BY bucket, breakdown
      ORDER BY breakdown, bucket WITH FILL
        FROM ${bucketOf("toDateTime({from:DateTime}, 'UTC')")}
        TO least(toDateTime({to:DateTime}, 'UTC'), now())
        STEP INTERVAL 1 ${unit}
    )
    ORDER BY breakdown, t`;
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

// The page's code is in src/client.tsx, and the build bundles it because superwall.json names it.
// Browser code holds no credential, so it asks this Worker, which calls Superwall as the person viewing it.
// /v2/projects needs projects:read in superwall.json; without it, this call answers 403.
// SQL (/v2/organizations/:id/query, data:read) works here and in a metric, and not in a slot tied to one app.
const serve = ({ request, context }: WorkspaceRequest) => {
  const { pathname } = new URL(request.url);
  if (pathname === "/") return clientPage(client, { title: "My workspace" });
  if (pathname === "/api/projects") {
    const { organizationId } = context as OrgPageContextV1;
    return superwallFetch(`/v2/projects?organization_id=${organizationId}`);
  }
  return new Response("Not found", { status: 404 });
};

export default defineWorkspace({ client, fetch: serve, metric });
