import { describe, expect, it } from "vitest";
import type { SuperwallConfig } from "../../src/config";
import { snapshotPatchFor } from "../../src/session/incoming";
import { createSuperwallSession } from "../../src/session";
import { TestTransport } from "../support/testTransport";

const snapshotWith = (config?: SuperwallConfig) =>
  createSuperwallSession({ transport: new TestTransport(), config }).getSnapshot();

describe("snapshotPatchFor", () => {
  it("resets transaction state when the paywall (re)opens", () => {
    expect(
      snapshotPatchFor(snapshotWith(), {
        event_name: "paywall_open",
        paywall_id: "1",
        paywall_identifier: "pw",
      }),
    ).toEqual({
      paywall: { id: "1", identifier: "pw" },
      pendingPurchase: undefined,
      lastTransaction: undefined,
      lastPurchaseFailure: undefined,
    });
  });

  it("splits template variables into device, user and params", () => {
    const variables = { device: { platform: "iOS" }, user: { firstName: "Ada" }, params: 3 };
    expect(
      snapshotPatchFor(snapshotWith(), { event_name: "template_variables", variables }),
    ).toEqual({
      variables,
      device: { platform: "iOS" },
      user: { firstName: "Ada" },
      params: {},
    });
  });

  it("derives eligibility from the prefix", () => {
    const prefix = { event_name: "template_substitutions_prefix" as const, prefix: "freeTrial" };
    expect(snapshotPatchFor(snapshotWith(), prefix)).toEqual({
      introductoryOffer: { eligible: true },
    });
    expect(snapshotPatchFor(snapshotWith(), { ...prefix, prefix: null })).toEqual({
      introductoryOffer: { eligible: false },
    });
  });

  it("records experiment, restore lifecycle, tracking behavior and permissions", () => {
    const snapshot = snapshotWith();
    expect(
      snapshotPatchFor(snapshot, {
        event_name: "experiment",
        experimentId: "e",
        variantId: "v",
        campaignId: "c",
      }),
    ).toEqual({ experiment: { experimentId: "e", variantId: "v", campaignId: "c" } });
    expect(snapshotPatchFor(snapshot, { event_name: "restore_start" })).toEqual({
      restore: { status: "started" },
    });
    expect(snapshotPatchFor(snapshot, { event_name: "restore_complete" })).toEqual({
      restore: { status: "completed" },
    });
    expect(snapshotPatchFor(snapshot, { event_name: "restore_fail" })).toEqual({
      restore: { status: "failed" },
    });
    expect(
      snapshotPatchFor(snapshot, { event_name: "event_tracking_behavior", behavior: "none" }),
    ).toEqual({ eventTrackingBehavior: "none" });
    expect(
      snapshotPatchFor(snapshot, {
        event_name: "permission_result",
        permission_type: "background_location",
        request_id: "r",
        status: "granted",
      }),
    ).toEqual({ permissionStatuses: { backgroundLocation: "granted" } });
  });

  it("has no patch for messages that carry no snapshot state", () => {
    expect(
      snapshotPatchFor(snapshotWith(), { event_name: "substitution_editor_focused" }),
    ).toBeUndefined();
  });
});
