export const isStripeProductIdentifier = (identifier: string | undefined): boolean =>
  typeof identifier === "string" && /^(stripe\|)?(test|live):price_[^:]+/.test(identifier);

export const bareProductIdentifier = (identifier: string): string =>
  identifier.replace(/^stripe\|/, "");
