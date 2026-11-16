import { field } from "./decode";
import { subscriptionsApiUrl } from "./url";

const SESSION_TIMEOUT_MS = 20_000;

export type CustomStoreSessionAnswer =
  | { kind: "answered"; ok: boolean; status: number; body: unknown }
  | { kind: "timeout" }
  | { kind: "unsent" };

const timeoutSignal = (ms: number): AbortSignal => {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(
    () => controller.abort(new DOMException("The operation timed out.", "TimeoutError")),
    ms,
  );
  return controller.signal;
};

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

export const postCustomStoreSession = async (
  publicApiKey: string,
  body: unknown,
): Promise<CustomStoreSessionAnswer> => {
  let response: Response;
  try {
    response = await fetch(subscriptionsApiUrl("checkout/custom-store/session"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${publicApiKey}`,
      },
      body: JSON.stringify(body),
      signal: timeoutSignal(SESSION_TIMEOUT_MS),
    });
  } catch (error) {
    return field(error, "name") === "TimeoutError" ? { kind: "timeout" } : { kind: "unsent" };
  }
  return {
    kind: "answered",
    ok: response.ok,
    status: response.status,
    body: await readJson(response),
  };
};
