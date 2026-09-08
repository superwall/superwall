import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { SuperwallConfig } from "../../src/config";
import { createSuperwallProduct } from "../../src/products";
import { trialReminderFor, type TrialReminderContext } from "../../src/session/reminders";

const DAY = 24 * 60 * 60 * 1000;

const context: TrialReminderContext = {
  products: [createSuperwallProduct({ reference: "primary", productId: "pro_year" })],
  t: (key) => (key === "notifications.title" ? "Trial ending soon" : key),
  locale: "en",
  paywallIdentifier: "pw-identifier",
};

const started = (trialEnd: string | number | undefined) => ({
  event_name: "freeTrial_start" as const,
  product_identifier: "pro_year",
  ...(trialEnd === undefined ? {} : { trial_end_date: trialEnd }),
});

describe("trialReminderFor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules a static reminder, localized, a day before the trial ends", () => {
    const config: SuperwallConfig = {
      notifications: {
        trialReminder: { title: "notifications.title", subtitle: "sub", body: "Plain body" },
      },
    };
    expect(trialReminderFor(config, started("2026-07-23T00:00:00Z"), context)).toEqual({
      event_name: "schedule_notification",
      id: "pw-identifier_TRIAL_STARTED",
      type: "TRIAL_STARTED",
      title: "Trial ending soon",
      subtitle: "sub",
      body: "Plain body",
      delay: 6 * DAY,
    });
  });

  it("reads an epoch in milliseconds, which is what iOS sends", () => {
    const config: SuperwallConfig = {
      notifications: { trialReminder: { title: "T", body: "B", beforeTrialEndDays: 2 } },
    };
    expect(
      trialReminderFor(config, started(Date.parse("2026-07-23T00:00:00Z")), {
        ...context,
        paywallIdentifier: undefined,
      }),
    ).toMatchObject({ id: "paywall_TRIAL_STARTED", delay: 5 * DAY });
  });

  it("computes dynamic reminders from the trial context, with the matching product", () => {
    const config: SuperwallConfig = {
      notifications: {
        trialReminder: ({ trialEndDate, product, productIdentifier, t, locale }) => ({
          title: t("Almost over"),
          body: `${trialEndDate.toISOString().slice(0, 10)} ${product?.reference} ${productIdentifier} ${locale}`,
          delayMs: 1000,
        }),
      },
    };
    expect(trialReminderFor(config, started("2026-07-23T00:00:00Z"), context)).toMatchObject({
      title: "Almost over",
      body: "2026-07-23 primary pro_year en",
      delay: 1000,
    });
  });

  it("schedules nothing when there is no reminder, no usable end date, or it is disabled", () => {
    const enabled: SuperwallConfig = {
      notifications: { trialReminder: { title: "T", body: "B" } },
    };
    expect(trialReminderFor(undefined, started("2026-07-23T00:00:00Z"), context)).toBeUndefined();
    expect(trialReminderFor(enabled, started(undefined), context)).toBeUndefined();
    expect(trialReminderFor(enabled, started("not a date"), context)).toBeUndefined();
    expect(
      trialReminderFor(
        { notifications: { trialReminder: { title: "T", body: "B", enabled: false } } },
        started("2026-07-23T00:00:00Z"),
        context,
      ),
    ).toBeUndefined();
  });

  it("schedules nothing when the function declines or the moment has passed", () => {
    expect(
      trialReminderFor(
        { notifications: { trialReminder: () => null } },
        started("2026-07-23T00:00:00Z"),
        context,
      ),
    ).toBeUndefined();
    expect(
      trialReminderFor(
        { notifications: { trialReminder: { title: "T", body: "B" } } },
        started("2026-07-16T12:00:00Z"),
        context,
      ),
    ).toBeUndefined();
  });
});
