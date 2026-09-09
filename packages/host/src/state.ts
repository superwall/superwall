export type HostVariables = Record<string, unknown>;

export type HostProduct = {
  reference: string;
  productId: string;
  variables: HostVariables;
};

export type HostExperiment = {
  experimentId: string;
  variantId: string;
  campaignId: string;
};

export type HostState = {
  paywallId: string;
  paywallIdentifier: string;
  device: HostVariables;
  user: HostVariables;
  params: HostVariables;
  products: readonly HostProduct[];
  introductoryOfferEligible?: boolean;
  experiment: HostExperiment;
};

export type HostStatePatch = Partial<HostState>;

export const NO_EXPERIMENT: HostExperiment = { experimentId: "0", variantId: "0", campaignId: "0" };

const defined = (variables: HostVariables): HostVariables =>
  Object.fromEntries(Object.entries(variables).filter(([, value]) => value !== undefined));

export const createHostState = (patch: HostStatePatch = {}): HostState => ({
  paywallId: patch.paywallId ?? "0",
  paywallIdentifier: patch.paywallIdentifier ?? "paywall",
  device: defined(patch.device ?? {}),
  user: defined(patch.user ?? {}),
  params: defined(patch.params ?? {}),
  products: patch.products ?? [],
  experiment: patch.experiment ?? NO_EXPERIMENT,
  ...(patch.introductoryOfferEligible === undefined
    ? {}
    : { introductoryOfferEligible: patch.introductoryOfferEligible }),
});

export const mergeHostState = (state: HostState, patch: HostStatePatch): HostState => {
  const next: HostState = {
    ...state,
    paywallId: patch.paywallId ?? state.paywallId,
    paywallIdentifier: patch.paywallIdentifier ?? state.paywallIdentifier,
    device: patch.device ? defined({ ...state.device, ...patch.device }) : state.device,
    user: patch.user ? defined({ ...state.user, ...patch.user }) : state.user,
    params: patch.params ? defined({ ...state.params, ...patch.params }) : state.params,
    products: patch.products ?? state.products,
    experiment: patch.experiment ?? state.experiment,
  };
  if ("introductoryOfferEligible" in patch) {
    if (patch.introductoryOfferEligible === undefined) delete next.introductoryOfferEligible;
    else next.introductoryOfferEligible = patch.introductoryOfferEligible;
  }
  return next;
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const diffVariables = (before: HostVariables, after: HostVariables): HostVariables | undefined => {
  const patch: HostVariables = {};
  let changed = false;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!(key in after)) {
      patch[key] = undefined;
      changed = true;
    } else if (!same(before[key], after[key])) {
      patch[key] = after[key];
      changed = true;
    }
  }
  return changed ? patch : undefined;
};

export const diffHostState = (previous: HostState, next: HostState): HostStatePatch => {
  const patch: HostStatePatch = {};
  const device = diffVariables(previous.device, next.device);
  if (device) patch.device = device;
  const user = diffVariables(previous.user, next.user);
  if (user) patch.user = user;
  const params = diffVariables(previous.params, next.params);
  if (params) patch.params = params;
  if (!same(previous.products, next.products)) patch.products = next.products;
  if (previous.introductoryOfferEligible !== next.introductoryOfferEligible) {
    patch.introductoryOfferEligible = next.introductoryOfferEligible;
  }
  if (previous.paywallId !== next.paywallId) patch.paywallId = next.paywallId;
  if (previous.paywallIdentifier !== next.paywallIdentifier) {
    patch.paywallIdentifier = next.paywallIdentifier;
  }
  if (!same(previous.experiment, next.experiment)) patch.experiment = next.experiment;
  return patch;
};

export const trialPeriodDays = (product: HostProduct): number => {
  const raw = product.variables.trialPeriodDays;
  const days = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 0;
  return Number.isFinite(days) ? days : 0;
};

export const hasIntroductoryOffer = (state: HostState): boolean =>
  state.introductoryOfferEligible ?? state.products.some((product) => trialPeriodDays(product) > 0);
