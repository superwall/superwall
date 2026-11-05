import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContext, defaultRange, missingFields, slotOf, SLOTS } from "@/core/workspaces/slots";

test("an org page needs only its organization", () => {
  assert.deepEqual(buildContext("org.page@1", { organizationId: "12" }), { organizationId: 12 });
});

test("a missing field names the flag that fills it", () => {
  assert.throws(() => buildContext("app.page@1", { organizationId: "12" }), /an app \(--app\)/);
  assert.throws(() => buildContext("user.panel@1", { organizationId: "1", applicationId: "2" }), /a user \(--user\)/);
  assert.deepEqual(missingFields(slotOf("campaign.tab@1"), {}), [
    "an organization (--org)",
    "an app (--app)",
    "a campaign (--campaign)",
  ]);
});

test("a campaign tab may have no audience, and ids become numbers", () => {
  const context = buildContext("campaign.tab@1", {
    organizationId: "1",
    applicationId: "2",
    campaignId: "3",
    variantIds: ["4", "5"],
    from: "2026-10-01T00:00:00Z",
    to: "2026-10-02T00:00:00+00:00",
  });
  assert.deepEqual(context, {
    organizationId: 1,
    applicationId: 2,
    campaignId: 3,
    audienceId: null,
    variantIds: [4, 5],
    environment: "PRODUCTION",
    dateRange: { from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" },
  });
});

test("a readout needs its audience, unlike a tab", () => {
  assert.deepEqual(missingFields(slotOf("campaign.metric@1"), { organizationId: "1", applicationId: "2", campaignId: "3" }), [
    "an audience (--audience)",
  ]);
});

test("a user panel carries the user, aliases and environment", () => {
  assert.deepEqual(
    buildContext("user.panel@1", {
      organizationId: "1",
      applicationId: "2",
      appUserId: "alice",
      aliases: ["a2"],
      environment: "SANDBOX",
    }),
    { organizationId: 1, applicationId: 2, appUserId: "alice", aliases: ["a2"], environment: "SANDBOX" },
  );
});

test("widgets default to the last 30 days", () => {
  const context = buildContext("app.dashboard.widget@1", { organizationId: "1", applicationId: "2" });
  const { from, to } = context.dateRange as { from: string; to: string };
  assert.ok(Date.parse(to) - Date.parse(from) >= 30 * 86_400_000 - 1000);
  assert.deepEqual(defaultRange(1, 86_400_000), { from: "1970-01-01T00:00:00.000Z", to: "1970-01-02T00:00:00.000Z" });
});

test("bad ids and dates are refused", () => {
  assert.throws(() => buildContext("org.page@1", { organizationId: "x" }), /The organization must be a positive number/);
  assert.throws(
    () => buildContext("app.dashboard.widget@1", { organizationId: "1", applicationId: "2", from: "yesterday" }),
    /ISO 8601/,
  );
});

test("an unknown slot points at --context, which takes the whole context", () => {
  assert.throws(() => slotOf("paywall.panel@1"), /--context/);
  assert.deepEqual(buildContext("paywall.panel@1", { context: '{"paywallId":9}' }), { paywallId: 9 });
  assert.deepEqual(buildContext("chart.source@1", { organizationId: "1", applicationId: "2", context: '{"applicationId":3}' }), {
    organizationId: 1,
    applicationId: 3,
  });
  assert.throws(() => buildContext("org.page@1", { context: "{nope" }), /not valid JSON/);
  assert.throws(() => buildContext("org.page@1", { context: "[]" }), /must be a JSON object/);
});

test("every slot's bounds fit its shape", () => {
  for (const [id, slot] of Object.entries(SLOTS)) {
    assert.ok(slot.fields.includes("organizationId"), id);
    if (slot.maxHeight !== null) assert.ok(slot.minHeight <= slot.maxHeight, id);
  }
});

test("the environment is PRODUCTION or SANDBOX, in capitals, however it arrives", () => {
  const input = { organizationId: "1", applicationId: "2", appUserId: "alice" };
  for (const environment of ["production", "sandbox", "Production", ""]) {
    assert.throws(() => buildContext("user.panel@1", { ...input, environment }), /must be PRODUCTION or SANDBOX, in capitals/);
  }
  assert.throws(() => buildContext("user.panel@1", { context: '{"environment":"production"}' }), /in capitals\. Got production\./);
  assert.equal(buildContext("user.panel@1", { context: '{"environment":"SANDBOX"}' }).environment, "SANDBOX");
  assert.deepEqual(buildContext("org.page@1", { context: '{"organizationId":1}' }), { organizationId: 1 });
  assert.equal(buildContext("user.panel@1", input).environment, "PRODUCTION");
});
