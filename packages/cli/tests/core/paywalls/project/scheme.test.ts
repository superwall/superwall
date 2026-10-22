import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import {
  allowLocalNetworking,
  plutilAvailable,
  allowsLocalNetworking,
  appScheme,
  detectAppTransportSecurity,
  detectLocalScheme,
  schemeFromAndroidManifest,
  schemeFromExpoConfig,
  schemeFromInfoPlist,
  schemeSearchRoots,
} from "@/core/paywalls/project/scheme";
import { restoreBin, useBin } from "../../../helpers/bin";

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "sw-scheme-"));

const runsAsRoot = process.getuid?.() === 0;

afterEach(() => {
  restoreBin();
});

test("reads the first usable scheme from an Info.plist", () => {
  const plist = `<plist><dict>
  <key>CFBundleURLTypes</key><array><dict>
    <key>CFBundleURLSchemes</key><array><string>exampleapp</string><string>other</string></array>
  </dict></array>
</dict></plist>`;
  assert.equal(schemeFromInfoPlist(plist), "exampleapp");
  assert.equal(schemeFromInfoPlist("<plist><dict></dict></plist>"), undefined);
});

test("skips web schemes an app declares for universal links", () => {
  const plist = `<key>CFBundleURLSchemes</key><array><string>https</string><string>myapp</string></array>`;
  assert.equal(schemeFromInfoPlist(plist), "myapp");
  assert.equal(
    schemeFromInfoPlist(`<key>CFBundleURLSchemes</key><array><string>https</string></array>`),
    undefined,
  );
});

test("reads expo config schemes, nested or flat, string or array", () => {
  assert.equal(schemeFromExpoConfig(`{"expo":{"scheme":"expoapp"}}`), "expoapp");
  assert.equal(schemeFromExpoConfig(`{"scheme":"flatapp"}`), "flatapp");
  assert.equal(schemeFromExpoConfig(`{"expo":{"scheme":["first","second"]}}`), "first");
  assert.equal(schemeFromExpoConfig(`{"scheme":[3,"https","listedapp"]}`), "listedapp");
  assert.equal(schemeFromExpoConfig(`{"scheme":["http"]}`), undefined);
  assert.equal(schemeFromExpoConfig(`{"scheme":3}`), undefined);
  assert.equal(schemeFromExpoConfig("not json"), undefined);
  assert.equal(schemeFromExpoConfig("null"), undefined);
  assert.equal(schemeFromExpoConfig(`{"expo":{}}`), undefined);
});

test("reads android manifest schemes, ignoring http intent filters", () => {
  const manifest = `<intent-filter><data android:scheme="https" android:host="x"/></intent-filter>
  <intent-filter><data android:scheme="androidapp"/></intent-filter>`;
  assert.equal(schemeFromAndroidManifest(manifest), "androidapp");
  assert.equal(schemeFromAndroidManifest(`<data android:scheme="http"/>`), undefined);
});

test("finds a scheme by scanning an app directory", async () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, "App"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "App", "Info.plist"),
    `<key>CFBundleURLSchemes</key><array><string>scannedapp</string></array>`,
  );
  assert.equal(await detectLocalScheme(root), "scannedapp");
  assert.equal(await detectLocalScheme(tempDir()), undefined);
});

test("prefers the dashboard scheme and falls back to the app", async () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "app.json"), `{"expo":{"scheme":"localapp"}}`);

  assert.deepEqual(await appScheme(root, async () => "dashboardapp"), {
    scheme: "dashboardapp",
    source: "dashboard",
  });
  assert.deepEqual(await appScheme(root, async () => undefined), {
    scheme: "localapp",
    source: "app",
  });
  assert.deepEqual(
    await appScheme(root, async () => {
      throw new Error("offline");
    }),
    { scheme: "localapp", source: "app" },
  );
  assert.deepEqual(await appScheme(tempDir(), async () => undefined), {});
});

test("looks beside superwall/ when the command ran from inside it", async () => {
  const appRoot = tempDir();
  const superwallDir = path.join(appRoot, "superwall");
  fs.mkdirSync(path.join(appRoot, "MyApp"), { recursive: true });
  fs.mkdirSync(superwallDir, { recursive: true });
  fs.writeFileSync(path.join(appRoot, "package.json"), `{"name":"my-app"}`);
  fs.writeFileSync(
    path.join(appRoot, "MyApp", "Info.plist"),
    `<key>CFBundleURLSchemes</key><array><string>siblingapp</string></array>`,
  );

  assert.deepEqual(schemeSearchRoots({ root: appRoot, superwallDir }), [appRoot]);

  const roots = schemeSearchRoots({ root: superwallDir, superwallDir });
  assert.deepEqual(roots, [superwallDir, appRoot]);
  assert.equal(await detectLocalScheme(roots), "siblingapp");
});

test("reads whether App Transport Security allows the local dev server", () => {
  const blocked = `<plist><dict><key>CFBundleIdentifier</key><string>x</string></dict></plist>`;
  assert.equal(allowsLocalNetworking(blocked), false);

  const partial = `<key>NSAppTransportSecurity</key><dict>
    <key>NSAllowsLocalNetworking</key><true/></dict>`;
  assert.equal(allowsLocalNetworking(partial), false);

  const allowed = `<key>NSAppTransportSecurity</key><dict>
    <key>NSAllowsLocalNetworking</key><true/>
    <key>NSAllowsArbitraryLoadsInWebContent</key><true/></dict>`;
  assert.equal(allowsLocalNetworking(allowed), true);

  const blanket = `<key>NSAppTransportSecurity</key><dict>
    <key>NSAllowsArbitraryLoads</key><true/></dict>`;
  assert.equal(allowsLocalNetworking(blanket), true);
});

test("points at the app's Info.plist when it would block the dev server", async () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, "MyApp"), { recursive: true });
  const plist = path.join(root, "MyApp", "Info.plist");
  fs.writeFileSync(plist, `<key>CFBundleIdentifier</key><string>com.example</string>`);

  assert.deepEqual(await detectAppTransportSecurity(root), { plist, allowed: false });

  fs.writeFileSync(
    plist,
    `<key>CFBundleIdentifier</key><string>com.example</string>
     <key>NSAppTransportSecurity</key><dict>
       <key>NSAllowsLocalNetworking</key><true/>
       <key>NSAllowsArbitraryLoadsInWebContent</key><true/></dict>`,
  );
  assert.deepEqual(await detectAppTransportSecurity(root), { plist, allowed: true });

  assert.equal(await detectAppTransportSecurity(tempDir()), undefined);
});

test("survives a dashboard app whose scheme is null, and still checks the app", async () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "app.json"), `{"expo":{"scheme":"localapp"}}`);

  assert.deepEqual(await appScheme(root, async () => null), {
    scheme: "localapp",
    source: "app",
  });

  assert.deepEqual(await appScheme(root, async () => "   "), {
    scheme: "localapp",
    source: "app",
  });
});

test("never searches the directory a loose project happens to sit in", async () => {
  const holder = tempDir();
  const superwallDir = path.join(holder, "superwall");
  fs.mkdirSync(superwallDir, { recursive: true });
  fs.mkdirSync(path.join(holder, "SomeoneElsesApp"), { recursive: true });
  fs.writeFileSync(
    path.join(holder, "SomeoneElsesApp", "Info.plist"),
    `<key>CFBundleIdentifier</key><string>x</string>
<key>CFBundleURLSchemes</key><array><string>strangerapp</string></array>`,
  );

  const roots = schemeSearchRoots({ root: superwallDir, superwallDir });

  assert.deepEqual(roots, [superwallDir]);
  assert.equal(await detectLocalScheme(roots), undefined);
  assert.equal(await detectAppTransportSecurity(roots), undefined);
});

test("recognises a native app root by its Xcode project", async () => {
  const appRoot = tempDir();
  const superwallDir = path.join(appRoot, "superwall");
  fs.mkdirSync(path.join(appRoot, "MyApp.xcodeproj"), { recursive: true });
  fs.mkdirSync(superwallDir, { recursive: true });
  fs.writeFileSync(
    path.join(appRoot, "Info.plist"),
    `<key>CFBundleURLSchemes</key><array><string>nativeapp</string></array>`,
  );

  const roots = schemeSearchRoots({ root: superwallDir, superwallDir });

  assert.deepEqual(roots, [superwallDir, appRoot]);
  assert.equal(await detectLocalScheme(roots), "nativeapp");
});

const PLIST = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>
`;

test("allows local networking in a plist that has no App Transport Security yet", { skip: !(await plutilAvailable()) }, async () => {
  const file = path.join(tempDir(), "Info.plist");
  fs.writeFileSync(file, PLIST("\t<key>CFBundleIdentifier</key>\n\t<string>com.example.app</string>"));

  await allowLocalNetworking(file);

  assert.equal(allowsLocalNetworking(fs.readFileSync(file, "utf8")), true);
});

test("keeps the exceptions an app already declared", { skip: !(await plutilAvailable()) }, async () => {
  const file = path.join(tempDir(), "Info.plist");
  fs.writeFileSync(
    file,
    PLIST(
      "\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSExceptionDomains</key>\n\t\t<dict/>\n\t</dict>",
    ),
  );

  await allowLocalNetworking(file);

  const contents = fs.readFileSync(file, "utf8");
  assert.equal(allowsLocalNetworking(contents), true);
  assert.ok(contents.includes("NSExceptionDomains"));
});

test("is safe to run again on a plist that already allows it", { skip: !(await plutilAvailable()) }, async () => {
  const file = path.join(tempDir(), "Info.plist");
  fs.writeFileSync(file, PLIST("\t<key>CFBundleIdentifier</key>\n\t<string>com.example.app</string>"));

  await allowLocalNetworking(file);
  await allowLocalNetworking(file);

  assert.equal(allowsLocalNetworking(fs.readFileSync(file, "utf8")), true);
});

test("a plist that belongs to no app is passed over for the app's own", async () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, "A"), { recursive: true });
  fs.mkdirSync(path.join(root, "B"), { recursive: true });
  fs.writeFileSync(path.join(root, "A", "Info.plist"), `<key>NSPrincipalClass</key><string>x</string>`);
  const plist = path.join(root, "B", "Info.plist");
  fs.writeFileSync(plist, `<key>CFBundleURLTypes</key><array/>`);

  assert.deepEqual(await detectAppTransportSecurity(root), { plist, allowed: false });
});

test("a file that cannot be read is skipped, never fatal", { skip: runsAsRoot }, async () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, "A"), { recursive: true });
  fs.mkdirSync(path.join(root, "B"), { recursive: true });
  const locked = path.join(root, "A", "Info.plist");
  fs.writeFileSync(locked, `<key>CFBundleURLSchemes</key><array><string>lockedapp</string></array>`);
  fs.chmodSync(locked, 0o000);
  const plist = path.join(root, "B", "Info.plist");
  fs.writeFileSync(
    plist,
    `<key>CFBundleIdentifier</key><string>x</string><key>CFBundleURLSchemes</key><array><string>openapp</string></array>`,
  );

  try {
    assert.equal(await detectLocalScheme(root), "openapp");
    assert.deepEqual(await detectAppTransportSecurity(root), { plist, allowed: false });
  } finally {
    fs.chmodSync(locked, 0o644);
  }
});

test("a parent directory that cannot be listed is not taken for an app root", { skip: runsAsRoot }, () => {
  const holder = tempDir();
  const superwallDir = path.join(holder, "superwall");
  fs.mkdirSync(superwallDir);
  fs.chmodSync(holder, 0o311);

  try {
    assert.deepEqual(schemeSearchRoots({ root: superwallDir, superwallDir }), [superwallDir]);
  } finally {
    fs.chmodSync(holder, 0o755);
  }
});

test("a project at the filesystem root has no level above to search", () => {
  assert.deepEqual(schemeSearchRoots({ root: "/", superwallDir: "/" }), ["/"]);
});

test("without plutil, editing an Info.plist says what it needs", async () => {
  process.env.PATH = useBin({});
  const file = path.join(tempDir(), "Info.plist");
  fs.writeFileSync(file, PLIST(""));

  assert.equal(await plutilAvailable(), false);
  await assert.rejects(allowLocalNetworking(file), {
    message: "Editing an Info.plist needs `plutil`, which ships with macOS.",
  });
  assert.equal(fs.readFileSync(file, "utf8"), PLIST(""));
});
