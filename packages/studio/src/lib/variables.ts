export type SampleDefaults = {
  device: Record<string, unknown>;
  user: Record<string, unknown>;
  params: Record<string, unknown>;
};

export type VariableOverrides = {
  device?: Record<string, unknown>;
  user?: Record<string, unknown>;
  params?: Record<string, unknown>;
  products?: Record<string, Record<string, unknown>>;
  introductoryOfferEligible?: boolean;
};
