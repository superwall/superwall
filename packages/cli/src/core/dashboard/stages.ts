import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import fg from "fast-glob";
import { DASHBOARD_URL } from "@/environment";
import { ui } from "@/ui";
import { withSpinner } from "@/ui/spinner";
import { generateStoreKit } from "@/core/dashboard/storekit";
import { formatJson } from "@/output";
import { createAscConfig, listAscConfigs } from "@/core/api/asc";
import {
  ascTypeDisplay,
  fetchUnimportedAscProducts,
  findAscAppId,
  listAscApps,
} from "@/core/api/asc-products";
import { createProduct, listResource, rowName, type Row, type Scope } from "@/core/api/resources";
import type { SuperwallApi } from "@/core/api/client";

const SKIP = "__skip__";

export interface StageCtx {
  api: SuperwallApi;
  scope: Scope;
  appName: string;
  bundleId?: string;
  projectDir?: string;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

type Flow = "back" | "done";

export async function runProductsStage(ctx: StageCtx): Promise<void> {
  const { api, scope } = ctx;
  const [products, ascConfigs] = await withSpinner("Checking products", async () => [
    await listResource(api, "products", scope),
    await listAscConfigs(api).catch(() => [] as Row[]),
  ]);
  const teamId = ascConfigs[0]
    ? String(ascConfigs[0].team_id ?? ascConfigs[0].id ?? "")
    : undefined;
  const storeKitFiles = await findStoreKitFiles(ctx.projectDir);

  if (products.length > 0) ui.success(`${count(products.length, "product")} already in Superwall.`);
  else ui.info("No products in Superwall yet.");

  for (;;) {
    const how = await ui.select({
      message: "How do you want to add products?",
      options: [
        {
          value: "asc",
          label: "Import from App Store Connect",
          hint: teamId ? "Connected" : "Connect your account",
        },
        {
          value: "storekit",
          label: "Import from a StoreKit file",
          hint: storeKitFiles.length ? basename(storeKitFiles[0]!) : "No StoreKit file found",
          disabled: storeKitFiles.length === 0,
        },
        ...(products.length > 0
          ? [
              {
                value: "export",
                label: "Generate a .storekit file",
                hint: "For Xcode testing",
              },
            ]
          : []),
        { value: SKIP, label: "Skip for now" },
      ],
      initialValue: "asc",
      footer: "esc to skip",
      transient: true,
    });
    if (how === null || how === SKIP) return;

    let result: Flow = "done";
    if (how === "asc") result = await ascFlow(ctx, products, teamId);
    else if (how === "storekit") result = await importFromStoreKit(ctx, products, storeKitFiles);
    else if (how === "export") writeStoreKit(products);

    if (result === "back") continue;
    return;
  }
}

async function ascFlow(ctx: StageCtx, products: Row[], teamId: string | undefined): Promise<Flow> {
  let team = teamId;
  if (!team) {
    const connected = await connectAppStoreConnect(ctx);
    if (connected === "back") return "back";
    team = connected;
  }
  return importFromAsc(ctx, team, products);
}

async function findStoreKitFiles(dir?: string): Promise<string[]> {
  if (!dir) return [];
  try {
    return await fg("**/*.storekit", {
      cwd: dir,
      absolute: true,
      deep: 6,
      suppressErrors: true,
      ignore: [
        "**/node_modules/**",
        "**/Pods/**",
        "**/build/**",
        "**/DerivedData/**",
        "**/.git/**",
      ],
    });
  } catch {
    return [];
  }
}

async function importFromStoreKit(
  ctx: StageCtx,
  existingProducts: Row[],
  files: string[],
): Promise<Flow> {
  const { api, scope } = ctx;

  let path = files[0]!;
  if (files.length > 1) {
    const sel = await ui.select({
      message: "Which StoreKit file?",
      options: files.map((f) => ({ value: f, label: basename(f), hint: f })),
      footer: "esc to go back",
      transient: true,
    });
    if (sel === null) return "back";
    path = sel;
  }

  let ids: string[];
  try {
    ids = storeKitProductIds(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    ui.error(`Couldn't read \`${basename(path)}\` as a StoreKit file.`);
    return "done";
  }
  if (ids.length === 0) {
    ui.warn("No products found in that StoreKit file.");
    return "done";
  }

  const existing = existingIdSet(existingProducts);
  const toImport = ids.filter((id) => !existing.has(id));
  if (toImport.length === 0) {
    ui.success("Those StoreKit products are already in Superwall.");
    return "done";
  }
  const picked = await ui.multiselect({
    message: `${count(toImport.length, "product")} in the StoreKit file`,
    options: toImport.map((id) => ({ value: id, label: id })),
    initialValues: toImport,
  });
  if (!picked || picked.length === 0) return "done";
  let imported = 0;
  for (const id of picked) {
    await withSpinner(`Importing ${id}`, () => createProduct(api, scope, id));
    imported++;
  }
  ui.success(`Imported ${count(imported, "product")} from the StoreKit file.`);
  return "done";
}

function storeKitProductIds(json: unknown): string[] {
  const ids = new Set<string>();
  const add = (arr: unknown) => {
    if (Array.isArray(arr)) for (const p of arr) if (p?.productID) ids.add(String(p.productID));
  };
  const j = (json ?? {}) as Record<string, unknown>;
  add(j.products);
  add(j.nonRenewingSubscriptions);
  for (const g of (j.subscriptionGroups as Array<Record<string, unknown>>) ?? [])
    add(g?.subscriptions);
  return [...ids];
}

function existingIdSet(products: Row[]): Set<string> {
  return new Set(
    products.map((p) => {
      const r = p as Record<string, unknown>;
      return String(r.identifier ?? r.product_identifier ?? rowName(p));
    }),
  );
}

async function connectAppStoreConnect(ctx: StageCtx): Promise<string | "back"> {
  const { api } = ctx;

  ui.note(
    [
      "Create an App Store Connect API key so Superwall can pull your products:",
      "",
      "1. Open App Store Connect → **Users and Access** → **Integrations** → **App Store Connect API**.",
      "2. Create a key with the **App Manager** role (or higher).",
      "3. Note the **Issuer ID** and download the **.p8** file.",
    ].join("\n"),
    "Connect App Store Connect",
  );

  let privateKey: string;
  let keyFilePath: string;
  for (;;) {
    const raw = await ui.text({
      message: "Path to the .p8 key file",
      placeholder: "~/Downloads/AuthKey_ABC123DEFG.p8",
      validate: required,
      footer: "esc to go back",
      transient: true,
    });
    if (raw === null) return "back";
    keyFilePath = cleanPath(raw);
    try {
      privateKey = readFileSync(keyFilePath, "utf8");
      break;
    } catch {
      ui.error(`Couldn't read \`${keyFilePath}\` - check the path and try again.`);
    }
  }

  let keyId: string;
  const fromName = keyIdFromFilename(keyFilePath);
  if (fromName) {
    keyId = fromName;
  } else {
    const entered = await ui.text({
      message: "Key ID",
      placeholder: "ABC123DEFG",
      validate: required,
      footer: "esc to go back",
      transient: true,
    });
    if (entered === null) return "back";
    keyId = entered.trim();
  }

  for (;;) {
    const issuerId = await ui.text({
      message: "Issuer ID",
      placeholder: "57246542-96fe-1a63-e053-0824d011072a",
      validate: required,
      footer: "esc to go back",
      transient: true,
    });
    if (issuerId === null) return "back";
    try {
      const config = await withSpinner("Connecting App Store Connect", () =>
        createAscConfig(api, {
          keyId,
          issuerId: issuerId.trim(),
          privateKey,
          accountName: ctx.appName || "App Store Connect",
        }),
      );
      const teamId = String(config.team_id ?? config.id ?? "");
      ui.success(`App Store Connect connected${teamId ? ` (team ${teamId})` : ""}.`);
      return teamId || "back";
    } catch {
      ui.error(
        "Couldn't verify that key. Check the Issuer ID and that the .p8 matches the Key ID, then try again.",
      );
    }
  }
}

// Apple names key files `AuthKey_<KEYID>.p8`.
function keyIdFromFilename(path: string): string | undefined {
  return basename(path).match(/AuthKey_([A-Za-z0-9]+)\.p8$/i)?.[1];
}

async function importFromAsc(
  ctx: StageCtx,
  teamId: string,
  existingProducts: Row[],
): Promise<Flow> {
  const { api, scope, bundleId } = ctx;

  let ascAppId = bundleId
    ? await withSpinner("Finding your app in App Store Connect", () =>
        findAscAppId(api, teamId, bundleId),
      )
    : undefined;

  if (!ascAppId) {
    const apps = await withSpinner("Loading App Store Connect apps", () =>
      listAscApps(api, teamId),
    );
    if (apps.length === 0) {
      ui.info("No apps in your App Store Connect account yet - skipping product import.");
      return "done";
    }
    const sel = await ui.select({
      message: bundleId
        ? `No App Store Connect app matches \`${bundleId}\`. Pick one:`
        : "Which App Store Connect app?",
      options: apps.map((a) => ({
        value: a.id,
        label: a.name ?? a.id,
        hint: a.bundleId,
      })),
      footer: "esc to go back",
      transient: true,
    });
    if (sel === null) return "back";
    ascAppId = sel;
  }

  const unimported = await withSpinner("Loading products from App Store Connect", () =>
    fetchUnimportedAscProducts(api, teamId, ascAppId, existingIdSet(existingProducts)),
  );
  if (unimported.length === 0) {
    ui.success("All App Store Connect products are already imported.");
    return "done";
  }

  const picked = await ui.multiselect({
    message: `${count(unimported.length, "product")} to import from App Store Connect`,
    options: unimported.map((p) => ({
      value: p.productId,
      label: p.productId,
      hint: [ascTypeDisplay(p.type), p.subscriptionPeriod].filter(Boolean).join(" · "),
    })),
    initialValues: unimported.map((p) => p.productId),
  });
  if (!picked || picked.length === 0) return "done";

  const byId = new Map(unimported.map((p) => [p.productId, p]));
  let imported = 0;
  for (const id of picked) {
    const p = byId.get(id);
    await withSpinner(`Importing ${id}`, () =>
      createProduct(api, scope, id, { name: p?.referenceName || undefined }),
    );
    imported++;
  }
  ui.success(`Imported ${count(imported, "product")} from App Store Connect.`);
  return "done";
}

function required(v: string): string | undefined {
  return v?.trim() ? undefined : "Required";
}

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function cleanPath(input: string): string {
  let s = input.trim();
  if (s.length >= 2 && ((s[0] === "'" && s.endsWith("'")) || (s[0] === '"' && s.endsWith('"')))) {
    s = s.slice(1, -1);
  }
  s = s.replace(/\\ /g, " "); // drag-and-drop escapes spaces as "\ "
  return expandHome(s.trim());
}

export function runPaywallStage(): void {
  ui.note(
    [
      "Build your paywall as code, or design it in the editor:",
      "",
      "  superwall create     scaffold a superwall/ directory, then superwall publish",
      `  ${DASHBOARD_URL}`,
      "",
      "Your agent also has the `superwall-editor` skill - ask it to build or edit a",
      "paywall in the editor from the CLI.",
    ].join("\n"),
    "Paywall",
  );
}

export async function runVerifyStage(ctx: StageCtx): Promise<void> {
  const { api, scope } = ctx;
  const [products, campaigns] = await withSpinner("Verifying setup", async () => [
    await listResource(api, "products", scope),
    await listResource(api, "campaigns", scope),
  ]);

  line(products.length > 0, `Products in Superwall: ${products.length}`);
  line(campaigns.length > 0, `Campaigns: ${campaigns.length}`);
  ui.note(
    [
      "To verify end to end:",
      "1. Run the app on a device/simulator.",
      "2. Hit the feature gate where you register the placement.",
      "3. Confirm the paywall presents and a test purchase completes.",
    ].join("\n"),
    "Next",
  );
}

function line(ok: boolean, text: string): void {
  if (ok) ui.success(text);
  else ui.warn(text);
}

function writeStoreKit(products: Row[]): void {
  const out = "Superwall.storekit";
  writeFileSync(out, `${formatJson(generateStoreKit(products))}\n`);
  ui.success(`Wrote \`${out}\` with ${count(products.length, "product")}.`);
}
