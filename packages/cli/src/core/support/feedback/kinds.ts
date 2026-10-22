export const FEEDBACK_KINDS = ["bug", "docs", "idea", "praise", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
