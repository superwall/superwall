import type { SuperwallProduct } from "../products";

export type SuperwallTrialReminderStaticConfig = {
  /** Default: `true`. */
  enabled?: boolean;
  /** Notification title. A message key resolves through `t()`; literal copy passes through. */
  title: string;
  /** Default: none. */
  subtitle?: string;
  /** Notification body. A message key resolves through `t()`; literal copy passes through. */
  body: string;
  /** How many days before the trial ends the reminder fires. Default: `1`. */
  beforeTrialEndDays?: number;
};

export type SuperwallTrialReminderContext = {
  /** When the trial ends, per the SDK. */
  trialEndDate: Date;
  /** Store identifier of the purchased product, when the SDK provides it. */
  productIdentifier?: string;
  /** The matching product, when it's one of this paywall's slots. */
  product?: SuperwallProduct;
  /** Translator for the active locale. */
  t: (key: string, values?: Record<string, string | number>) => string;
  locale: string;
};

export type SuperwallTrialReminderNotification = {
  title: string;
  subtitle?: string;
  body: string;
  /** Milliseconds from now until the notification fires; `0` or less skips it. */
  delayMs: number;
};

/**
 * Static config, or a function computing the notification from the trial
 * context. Return `null` from the function to skip scheduling.
 */
export type SuperwallTrialReminderConfig =
  | SuperwallTrialReminderStaticConfig
  | ((
      context: SuperwallTrialReminderContext,
    ) => SuperwallTrialReminderNotification | null | undefined);

export type SuperwallNotificationsConfig = {
  /** Scheduled when the SDK reports a trial started (`freeTrial_start`). Default: none. */
  trialReminder?: SuperwallTrialReminderConfig;
};
