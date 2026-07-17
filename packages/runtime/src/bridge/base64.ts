import type { TIncomingMessage } from "@superwall/protocol";

type BufferLike = {
  from(
    input: string,
    encoding: "base64",
  ): {
    toString(encoding: "utf8"): string;
  };
};

type GlobalWithBuffer = typeof globalThis & {
  Buffer?: BufferLike;
};

/**
 * Host SDKs may encode with URL-safe alphabets and without padding (e.g.
 * Android's Base64.URL_SAFE). atob is strict, so normalize first.
 */
const normalizeBase64 = (input: string) => {
  const standard = input.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const remainder = standard.length % 4;
  return remainder === 0 ? standard : standard + "=".repeat((4 - remainder) % 4);
};

export const decodeBase64Utf8 = (message: string) => {
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(normalizeBase64(message));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  const buffer = (globalThis as GlobalWithBuffer).Buffer;
  if (buffer) {
    return buffer.from(normalizeBase64(message), "base64").toString("utf8");
  }

  throw new Error("No base64 decoder is available in this runtime");
};

/**
 * Deliberately lenient, matching the original runtime: every object in the
 * batch is delivered, including messages this build doesn't recognize (newer
 * event types, or legacy quirks like the miscased `eventName: "experiment"`).
 * Strictly validating here would let one unknown message drop the whole batch.
 */
export const decodeIncomingMessages = (message: string): TIncomingMessage[] => {
  const parsed = JSON.parse(decodeBase64Utf8(message));
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(
    (entry): entry is TIncomingMessage => typeof entry === "object" && entry !== null,
  );
};
