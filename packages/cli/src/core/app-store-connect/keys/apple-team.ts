const ASC = "https://api.appstoreconnect.apple.com";
const TOKEN_SECONDS = 300;

export interface AppleKeyCredentials {
  keyId: string;
  issuerId: string;
  privateKey: string;
}

export type AppleKeyTeam =
  | { status: "ok"; teamId: string }
  | { status: "invalid_key" }
  | { status: "rejected"; httpStatus: number }
  | { status: "not_found" }
  | { status: "unreachable"; reason: string };

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const text = (value: string) => new TextEncoder().encode(value);

async function signingKey(pem: string): Promise<Awaited<ReturnType<typeof crypto.subtle.importKey>> | undefined> {
  try {
    const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
    const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
    return await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  } catch {
    return undefined;
  }
}

async function appleToken({ keyId, issuerId, privateKey }: AppleKeyCredentials): Promise<string | undefined> {
  const key = await signingKey(privateKey);
  if (!key) return undefined;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(text(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" })));
  const payload = base64url(
    text(JSON.stringify({ iss: issuerId, iat: now, exp: now + TOKEN_SECONDS, aud: "appstoreconnect-v1" })),
  );
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, text(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

interface BundleIdResource {
  type?: string;
  attributes?: { seedId?: string | null };
}

const seedId = (resource: BundleIdResource | undefined) => {
  const value = resource?.attributes?.seedId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

export async function readAppleKeyTeam(credentials: AppleKeyCredentials): Promise<AppleKeyTeam> {
  const token = await appleToken(credentials);
  if (!token) return { status: "invalid_key" };
  const get = async (path: string): Promise<{ status: number; body: unknown }> => {
    const res = await fetch(`${ASC}${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    return { status: res.status, body: res.ok ? await res.json() : undefined };
  };
  try {
    const bundles = await get("/v1/bundleIds?limit=1&fields[bundleIds]=seedId");
    if (bundles.status !== 200) return { status: "rejected", httpStatus: bundles.status };
    const fromBundles = seedId((bundles.body as { data?: BundleIdResource[] })?.data?.[0]);
    if (fromBundles) return { status: "ok", teamId: fromBundles };
    const apps = await get("/v1/apps?limit=1&include=bundleId");
    if (apps.status !== 200) return { status: "rejected", httpStatus: apps.status };
    const included = (apps.body as { included?: BundleIdResource[] })?.included;
    const fromApps = seedId(included?.find((entry) => entry.type === "bundleIds"));
    return fromApps ? { status: "ok", teamId: fromApps } : { status: "not_found" };
  } catch (error) {
    return { status: "unreachable", reason: error instanceof Error ? error.message : String(error) };
  }
}
