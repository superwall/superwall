import type { TIncomingMessageFreeTrialStart } from "@superwall/protocol";
import type { SuperwallConfig, SuperwallTrialReminderNotification } from "../config";
import { findProductByStoreId, type SuperwallProduct } from "../products";
import { scheduleNotification, type Outgoing } from "./outgoing";

const DAY_MS = 24 * 60 * 60 * 1000;

export type TrialReminderContext = {
  products: readonly SuperwallProduct[];
  t: (key: string, values?: Record<string, string | number>) => string;
  locale: string;
  paywallIdentifier: string | undefined;
};

const trialEndOf = (message: TIncomingMessageFreeTrialStart): number | undefined => {
  if (message.trial_end_date === undefined) return undefined;
  const ms =
    typeof message.trial_end_date === "number"
      ? message.trial_end_date
      : Date.parse(message.trial_end_date);
  return Number.isNaN(ms) ? undefined : ms;
};

export const trialReminderFor = (
  config: SuperwallConfig | undefined,
  message: TIncomingMessageFreeTrialStart,
  context: TrialReminderContext,
): Outgoing<"schedule_notification"> | undefined => {
  const reminder = config?.notifications?.trialReminder;
  const trialEndMs = trialEndOf(message);
  if (!reminder || trialEndMs === undefined) return undefined;

  let notification: SuperwallTrialReminderNotification | null | undefined;
  if (typeof reminder === "function") {
    notification = reminder({
      trialEndDate: new Date(trialEndMs),
      productIdentifier: message.product_identifier,
      product: findProductByStoreId(context.products, message.product_identifier),
      t: context.t,
      locale: context.locale,
    });
  } else if (reminder.enabled !== false) {
    notification = {
      title: context.t(reminder.title),
      ...(reminder.subtitle === undefined ? {} : { subtitle: context.t(reminder.subtitle) }),
      body: context.t(reminder.body),
      delayMs: trialEndMs - (reminder.beforeTrialEndDays ?? 1) * DAY_MS - Date.now(),
    };
  }

  if (!notification || notification.delayMs <= 0) return undefined;
  return scheduleNotification({
    id: `${context.paywallIdentifier ?? "paywall"}_TRIAL_STARTED`,
    ...notification,
  });
};
