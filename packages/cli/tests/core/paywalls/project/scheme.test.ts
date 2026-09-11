import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
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

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "sw-scheme-"));

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
});

test("reads expo config schemes, nested or flat, string or array", () => {
  assert.equal(schemeFromExpoConfig(`{"expo":{"scheme":"expoapp"}}`), "expoapp");
  assert.equal(schemeFromExpoConfig(`{"scheme":"flatapp"}`), "flatapp");
  assert.equal(schemeFromExpoConfig(`{"expo":{"scheme":["first","second"]}}`), "first");
  assert.equal(schemeFromExpoConfig("not json"), undefined);
  assert.equal(schemeFromExpoConfig(`{"expo":{}}`), undefined);
});

test("reads android manifest schemes, ignoring http intent filters", () => {
  const manifest = `<intent-filter><data android:scheme="https" android:host="x"/></intent-filter>
  <intent-filter><data android:scheme="androidapp"/></intent-filter>`;
  assert.equal(schemeFromAndroidManifest(manifest), "androidapp");
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
  // What makes the level above superwall/ the app: without a marker it is just
  // whatever directory the project happens to sit in.
  fs.writeFileSync(path.join(appRoot, "package.json"), `{"name":"my-app"}`);
  fs.writeFileSync(
    path.join(appRoot, "MyApp", "Info.plist"),
    `<key>CFBundleURLSchemes</key><array><string>siblingapp</string></array>`,
  );

  // run from the app root: the project root already contains the app
  assert.deepEqual(schemeSearchRoots({ root: appRoot, superwallDir }), [appRoot]);

  // run from inside superwall/: the app is one level up, and must still be found
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

  // no app at all: nothing to warn about
  assert.equal(await detectAppTransportSecurity(tempDir()), undefined);
});

test("survives a dashboard app whose scheme is null, and still checks the app", async () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "app.json"), `{"expo":{"scheme":"localapp"}}`);

  // the API returns JSON null for an app with no scheme set
  assert.deepEqual(await appScheme(root, async () => null), {
    scheme: "localapp",
    source: "app",
  });

  // and an empty/whitespace value is not a scheme either
  assert.deepEqual(await appScheme(root, async () => "   "), {
    scheme: "localapp",
    source: "app",
  });
});

test("never searches the directory a loose project happens to sit in", async () => {
  const holder = tempDir();
  const superwallDir = path.join(holder, "superwall");
  fs.mkdirSync(superwallDir, { recursive: true });
  // An unrelated app beside the project, as a home or temp directory would hold.
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
