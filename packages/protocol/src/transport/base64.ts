import type { TIncomingMessage } from "../messages";

const normalizeBase64 = (input: string): string => {
  const standard = input.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const remainder = standard.length % 4;
  return remainder === 0 ? standard : standard + "=".repeat(4 - remainder);
};

export const decodeBase64Utf8 = (message: string): string => {
  const binary = atob(normalizeBase64(message));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
};

const isMessageLike = (entry: unknown): entry is TIncomingMessage =>
  typeof entry === "object" && entry !== null;

export const decodeIncomingMessages = (message: string): TIncomingMessage[] => {
  const parsed: unknown = JSON.parse(decodeBase64Utf8(message));
  return Array.isArray(parsed) ? parsed.filter(isMessageLike) : [];
};
