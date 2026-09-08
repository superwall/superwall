import {
  createHostState,
  DEFAULT_PARAMS,
  DEFAULT_USER,
  defaultDevice,
  EXAMPLE_PRODUCT_VARIABLES,
  type HostProduct,
  type HostState,
  type HostStatePatch,
  type HostVariables,
} from "@superwall/host";
import type { SampleDefaults, Samples, StudioSurface, VariableOverrides } from "./types";

export type HostInputs = {
  surface: StudioSurface;
  defaults: SampleDefaults;
  sourceSamples?: SampleDefaults;
  samples: Samples;
  frame?: Record<string, unknown>;
  theme: "light" | "dark";
  locale?: string;
  edited: VariableOverrides;
};

export const studioDefaults = (): SampleDefaults => ({
  device: defaultDevice(),
  user: DEFAULT_USER,
  params: DEFAULT_PARAMS,
});

export const hostStateFor = ({
  surface,
  defaults,
  sourceSamples,
  samples,
  frame,
  theme,
  locale,
  edited,
}: HostInputs): HostState => {
  const device: HostVariables = {
    ...defaults.device,
    ...sourceSamples?.device,
    ...samples.device,
    ...frame,
    interfaceStyle: theme === "dark" ? "Dark" : "Light",
    ...(locale ? { deviceLocale: locale, deviceLanguageCode: locale.split(/[-_]/)[0] } : {}),
    ...edited.device,
  };
  const user: HostVariables = {
    ...defaults.user,
    ...sourceSamples?.user,
    ...samples.user,
    ...edited.user,
  };
  const params: HostVariables = {
    ...defaults.params,
    ...sourceSamples?.params,
    ...edited.params,
  };
  const products: HostProduct[] = Object.entries(surface.products ?? {}).map(
    ([reference, productId]) => ({
      reference,
      productId,
      variables: {
        ...(samples.products?.[productId] ?? EXAMPLE_PRODUCT_VARIABLES),
        ...edited.products?.[reference],
      },
    }),
  );
  return createHostState({
    paywallId: surface.paywallId ?? "0",
    paywallIdentifier: surface.paywallIdentifier ?? surface.id,
    device,
    user,
    params,
    products,
    introductoryOfferEligible: edited.introductoryOfferEligible,
  });
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const diffRecord = (before: HostVariables, after: HostVariables): HostVariables | undefined => {
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

export const hostPatch = (previous: HostState, next: HostState): HostStatePatch => {
  const patch: HostStatePatch = {};
  const device = diffRecord(previous.device, next.device);
  if (device) patch.device = device;
  const user = diffRecord(previous.user, next.user);
  if (user) patch.user = user;
  const params = diffRecord(previous.params, next.params);
  if (params) patch.params = params;
  if (!same(previous.products, next.products)) patch.products = next.products;
  if (previous.introductoryOfferEligible !== next.introductoryOfferEligible)
    patch.introductoryOfferEligible = next.introductoryOfferEligible;
  if (previous.paywallId !== next.paywallId) patch.paywallId = next.paywallId;
  if (previous.paywallIdentifier !== next.paywallIdentifier) {
    patch.paywallIdentifier = next.paywallIdentifier;
  }
  return patch;
};
