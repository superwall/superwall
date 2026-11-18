import * as React from "react";
import {
  LinkAuthenticationElement as StripeLinkAuthenticationElement,
  type LinkAuthenticationElementProps,
} from "@stripe/react-stripe-js";

export type EmailHandlers = {
  knownEmail: string | undefined;
  setEmail: (email: string | undefined) => void;
};

export const EmailContext = React.createContext<EmailHandlers | null>(null);

/**
 * Stripe's email field, which also signs a Link shopper in, collecting the
 * email for the nearest `<StripeCheckout>`. A card payment needs an email
 * for the subscription's customer, for the receipt, redemption and the
 * billing portal; render this field unless the paywall already knows the
 * shopper's email from its user attributes, which it is filled in with.
 */
export const LinkAuthenticationElement = (props: LinkAuthenticationElementProps) => {
  const email = React.useContext(EmailContext);
  if (email === null) {
    throw new Error("<LinkAuthenticationElement> must be rendered inside <StripeCheckout>.");
  }
  const { onChange, options } = props;
  const known = email.knownEmail;
  const merged = React.useMemo(
    () =>
      known === undefined || options?.defaultValues?.email
        ? options
        : { ...options, defaultValues: { ...options?.defaultValues, email: known } },
    [options, known],
  );
  return (
    <StripeLinkAuthenticationElement
      {...props}
      {...(merged ? { options: merged } : {})}
      onChange={(event) => {
        email.setEmail(event.complete ? event.value.email : undefined);
        onChange?.(event);
      }}
    />
  );
};
