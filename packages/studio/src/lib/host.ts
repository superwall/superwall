import {
  createHostState,
  DEFAULT_PARAMS,
  DEFAULT_USER,
  defaultDevice,
  type HostProduct,
  type HostState,
  type HostVariables,
} from "@superwall/host";
import type { Samples, StudioSurface } from "./surfaces";
import type { SampleDefaults, VariableOverrides } from "./variables";

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
        ...samples.products?.[productId],
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
