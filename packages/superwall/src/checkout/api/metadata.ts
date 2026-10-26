import { fetchWithRetry } from "./fetch";
import { subscriptionsApiUrl } from "./url";

export const attachCheckoutMetadata = async (
  publicApiKey: string,
  checkoutContextId: string,
  metadata: Readonly<Record<string, string>>,
): Promise<void> => {
  if (Object.keys(metadata).length === 0) return;
  await fetchWithRetry(subscriptionsApiUrl("checkout/session/custom-metadata"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${publicApiKey}` },
    body: JSON.stringify({ checkoutContextId, metadata, timing: "post_purchase" }),
  });
};
