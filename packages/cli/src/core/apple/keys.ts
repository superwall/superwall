import { field, textField } from "./transport";
import { AppleError, type AppleSession } from "./session";

export type AppleKeyKind = "team" | "purchase";
export type TeamKeyRole = "APP_MANAGER" | "ADMIN";

export interface AppleKey {
  id: string;
  issuerId: string;
  privateKey: string;
}

const RESOURCE: Record<AppleKeyKind, string> = {
  team: "apiKeys",
  purchase: "subscriptionKeys",
};

function decodePrivateKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("PRIVATE KEY")) return `${trimmed}\n`;
  const decoded = Buffer.from(trimmed, "base64").toString("utf8").trim();
  let pem = decoded;
  try {
    const unquoted: unknown = JSON.parse(decoded);
    if (typeof unquoted === "string") pem = unquoted.trim();
  } catch {
    pem = decoded;
  }
  if (!pem.includes("PRIVATE KEY")) {
    throw new AppleError("request", "Apple returned something that isn't a private key.");
  }
  return `${pem}\n`;
}

async function createKey(
  session: AppleSession,
  kind: AppleKeyKind,
  attributes: Record<string, unknown>,
): Promise<AppleKey> {
  const resource = RESOURCE[kind];
  const issuerId = session.team().issuerId;
  if (!issuerId) {
    throw new AppleError("request", "App Store Connect didn't say which issuer this team uses.");
  }
  const created = await session.iris("POST", `/${resource}`, {
    body: { data: { type: resource, attributes } },
  });
  const id = textField(field(created, "data"), "id");
  if (!id) throw new AppleError("request", "Apple created a key but didn't return its ID.");
  const downloaded = await session.iris("GET", `/${resource}/${encodeURIComponent(id)}`, {
    query: { [`fields[${resource}]`]: "privateKey" },
  });
  const privateKey = textField(field(field(downloaded, "data"), "attributes"), "privateKey");
  if (!privateKey) {
    throw new AppleError(
      "request",
      `Apple created key ${id} but didn't release its private key. Revoke it in App Store Connect → Users and Access → Integrations, then try again.`,
    );
  }
  return { id, issuerId, privateKey: decodePrivateKey(privateKey) };
}

export function createTeamKey(
  session: AppleSession,
  options: { name: string; role: TeamKeyRole },
): Promise<AppleKey> {
  return createKey(session, "team", {
    nickname: options.name,
    roles: [options.role],
    allAppsVisible: true,
    keyType: "PUBLIC_API",
  });
}

export function createPurchaseKey(session: AppleSession, options: { name: string }): Promise<AppleKey> {
  return createKey(session, "purchase", { nickname: options.name });
}

export async function checkKeyAccess(session: AppleSession, kind: AppleKeyKind): Promise<void> {
  await session.iris("GET", `/${RESOURCE[kind]}`, { query: { limit: "1" } });
}
