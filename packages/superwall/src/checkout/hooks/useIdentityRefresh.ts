import * as React from "react";
import { useSuperwallSession } from "../../provider/context";
import { useSuperwallSnapshot } from "../../hooks/useSuperwallSnapshot";
import { refreshIdentity } from "../flow";

/**
 * A checkout session is made for one shopper. The backend reads the identity
 * off the session body once, when the session is created: `user.email`
 * becomes Stripe's `customer_email` (the sheet shows it and does not let it be
 * changed) and `user.stripe_customer_id` pins the customer. That creation is
 * usually the prefetch on mount — before a funnel has asked for the email.
 *
 * So when either value changes afterwards — a funnel page calling
 * `setUserAttributes({ email })`, or a host delivering fresher variables —
 * every cached session is wrong: it would open the sheet with an empty,
 * editable email. Drop them and prefetch again, exactly what paywall.js does
 * on `user_attribute_updated`. An open sheet keeps its session (the reducer
 * preserves the active one on `SESSION_INVALIDATED`).
 *
 * The baseline is the identity seen once the host has delivered its
 * variables (`publicApiKey` arrives with them, and nothing is prefetched
 * before it), so an email the host knew from the start is not "a change".
 */
export const useIdentityRefresh = () => {
  const session = useSuperwallSession();
  const { device, user } = useSuperwallSnapshot();
  const ready = typeof device.publicApiKey === "string" && device.publicApiKey !== "";
  const email = typeof user.email === "string" ? user.email : "";
  const customerId = typeof user.stripe_customer_id === "string" ? user.stripe_customer_id : "";

  React.useEffect(() => {
    if (ready) refreshIdentity(session, `${email} ${customerId}`);
  }, [session, ready, email, customerId]);
};
