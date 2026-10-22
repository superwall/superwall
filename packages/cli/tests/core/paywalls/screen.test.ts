import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import {
  findScreenCandidates,
  placementOfName,
  readScreen,
  scanInterfaceBuilder,
  scanScreen,
  screenBrief,
  screenConfigSource,
  screenFrameworkLabel,
  screenFrameworkOf,
  screenNameOf,
  slugOfName,
} from "@/core/paywalls/screen";
import type { ScreenFramework } from "@/core/paywalls/project/lock";

const FIXTURES = path.resolve("tests/fixtures/screens");
const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const scratch = (files: Record<string, string>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-screen-"));
  dirs.push(dir);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
};

const kinds = (screen: ReturnType<typeof readScreen>) =>
  Object.fromEntries(screen.inventory.actions.map((action) => [action.kind, action.count]));

test("a SwiftUI screen yields its copy, assets, symbols, links, product and actions", () => {
  const screen = readScreen(process.cwd(), "tests/fixtures/screens/UpdateRequiredView.swift");
  assert.equal(screen.framework, "swiftui");
  assert.equal(screen.name, "Update Required");
  assert.equal(screen.slug, "update-required");
  assert.equal(screen.placement, "update_required");
  assert.equal(screen.path, "tests/fixtures/screens/UpdateRequiredView.swift");
  assert.deepEqual(screen.inventory.copy, [
    "Update required",
    "Version \\(minimumVersion) fixes sign-in. Update to keep using Acme.",
    "Update now",
    "Remind me later",
    "What's new",
    "Update required screen",
  ]);
  assert.deepEqual(screen.inventory.interpolations, ["minimumVersion"]);
  assert.deepEqual(screen.inventory.assets, ["rocket", "Inter-Bold"]);
  assert.deepEqual(screen.inventory.symbols, ["arrow.down.circle.fill"]);
  assert.deepEqual(screen.inventory.urls, [
    "https://apps.apple.com/app/id123456789",
    "https://acme.example/changelog",
  ]);
  assert.deepEqual(screen.inventory.productIds, ["com.acme.pro.annual"]);
  assert.deepEqual(kinds(screen), { "open-url": 2, "store-review": 1, dismiss: 1, tap: 2 });
});

test("a React Native screen yields JSX text and props without import paths or broken JSX", () => {
  const screen = readScreen(process.cwd(), "tests/fixtures/screens/UpdateRequiredScreen.tsx");
  assert.equal(screen.framework, "react-native");
  assert.equal(screen.name, "Update Required");
  assert.deepEqual(screen.inventory.copy, [
    "Rocket",
    "Version ${minimumVersion} fixes sign-in.",
    "Dismiss",
    "Update required",
    "Update now",
    "Notify me when it's ready",
    "Not now",
  ]);
  assert.deepEqual(screen.inventory.interpolations, ["minimumVersion"]);
  assert.deepEqual(screen.inventory.assets, ["../assets/rocket.png"]);
  assert.deepEqual(screen.inventory.urls, ["itms-apps://apps.apple.com/app/id123456789"]);
  assert.deepEqual(screen.inventory.productIds, ["acme_pro_annual"]);
  assert.deepEqual(kinds(screen), { "open-url": 1, notifications: 1, dismiss: 1, tap: 3 });
});

test("a Flutter screen yields its widgets' text, asset, link, product and purchase", () => {
  const screen = readScreen(process.cwd(), "tests/fixtures/screens/update_required_screen.dart");
  assert.equal(screen.framework, "flutter");
  assert.equal(screen.name, "Update Required");
  assert.equal(screen.placement, "update_required");
  assert.deepEqual(screen.inventory.copy, [
    "Update required",
    "Version $minimumVersion fixes sign-in.",
    "Update now",
    "Go Pro instead",
    "Not now",
  ]);
  assert.deepEqual(screen.inventory.interpolations, ["minimumVersion"]);
  assert.deepEqual(screen.inventory.assets, ["assets/rocket.png"]);
  assert.deepEqual(screen.inventory.urls, [
    "https://play.google.com/store/apps/details?id=com.acme.app",
  ]);
  assert.deepEqual(screen.inventory.productIds, ["acme_pro_annual"]);
  assert.deepEqual(kinds(screen), { purchase: 1, "open-url": 1, dismiss: 1, tap: 3 });
});

test("a UIKit controller is read too, with its target-action taps", () => {
  const screen = readScreen(process.cwd(), "tests/fixtures/screens/LegacyUpdateViewController.swift");
  assert.equal(screen.framework, "uikit");
  assert.equal(screen.name, "Legacy Update");
  assert.deepEqual(screen.inventory.copy, ["Update required", "Update now"]);
  assert.deepEqual(screen.inventory.assets, ["rocket"]);
  assert.deepEqual(screen.inventory.productIds, []);
  assert.deepEqual(kinds(screen), { "open-url": 1, tap: 1 });
});

test("interpolations, comments and multi-line strings follow each language", () => {
  const swift = scanScreen(
    'import SwiftUI\nstruct A: View {\n  // Text("not this")\n  /* Text("nor this") */\n  var body: some View { Text("""\n  Hello \\(name), welcome\n  """) }\n}\n',
    "swiftui",
  );
  assert.deepEqual(swift.copy, ["Hello \\(name), welcome"]);
  assert.deepEqual(swift.interpolations, ["name"]);

  const dart = scanScreen("Widget build() => Text('Hi ${user.name} and $count');", "flutter");
  assert.deepEqual(dart.interpolations, ["user.name", "count"]);

  const js = scanScreen("const A = () => <Text>{`Hi ${name}`}</Text>;", "react-native");
  assert.deepEqual(js.copy, ["Hi ${name}"]);
  assert.deepEqual(js.interpolations, ["name"]);
});

test("identifiers, colors, numbers, paths and escapes are not copy", () => {
  const inventory = scanScreen(
    [
      "import SwiftUI",
      "struct A: View {",
      '  let key = "some_key"',
      '  let color = "#FF00AA"',
      '  let math = "1 + 2"',
      '  let escaped = "\\n"',
      '  let percent = "%d"',
      '  let unfinished = "never closed',
      '  var body: some View { Text("Real copy here") }',
      "}",
    ].join("\n"),
    "swiftui",
  );
  assert.deepEqual(inventory.copy, ["Real copy here"]);
});

test("product identifiers need a product context; a reverse-DNS analytics key is not one", () => {
  const inventory = scanScreen(
    'import SwiftUI\nstruct A: View {\n  let ids = ["com.acme.pro.monthly", "com.acme.pro.annual"]\n  let sku: String = "pro_annual"\n  func track() { Analytics.log("screen.paywall.shown") }\n  var body: some View { Text("x") }\n}',
    "swiftui",
  );
  assert.deepEqual(inventory.productIds, ["com.acme.pro.monthly", "com.acme.pro.annual", "pro_annual"]);
});

test("names drop view suffixes, split any casing, and never come out empty", () => {
  assert.equal(screenNameOf("/a/ForceUpgradeViewController.swift"), "Force Upgrade");
  assert.equal(screenNameOf("rate-us-sheet.tsx"), "Rate Us");
  assert.equal(screenNameOf("whats_new_page.dart"), "Whats New");
  assert.equal(screenNameOf("HTTPErrorView.swift"), "HTTP Error");
  assert.equal(screenNameOf("View.swift"), "View");
  assert.equal(screenNameOf("_.swift"), "Screen");
  assert.equal(slugOfName("What's New!"), "what-s-new");
  assert.equal(slugOfName("!!!"), "screen");
  assert.equal(placementOfName("Rate Us"), "rate_us");
});

test("the framework is detected from the extension and the file's shape", () => {
  assert.equal(screenFrameworkOf("A.swift", "import SwiftUI\nstruct A: View {}"), "swiftui");
  assert.equal(screenFrameworkOf("A.swift", "class A: UIViewController {}"), "uikit");
  assert.equal(screenFrameworkOf("A.jsx", "export const A = () => <View />"), "react-native");
  assert.equal(screenFrameworkOf("a.dart", "class A extends StatelessWidget {}"), "flutter");
  assert.throws(() => screenFrameworkOf("A.swift", "let x = 1"), /no SwiftUI View or UIViewController/);
  assert.throws(() => screenFrameworkOf("a.ts", "export const x = 1"), /renders no JSX/);
  assert.throws(() => screenFrameworkOf("a.dart", "void main() {}"), /builds no Widget/);
  assert.throws(() => screenFrameworkOf("a.java", "class A"), /Can't read `a.java` as a screen/);
});

test("readScreen needs a real file and records paths relative to the project directory", () => {
  assert.throws(() => readScreen(process.cwd(), "tests/fixtures/screens/nope.swift"), /No file at/);
  assert.throws(() => readScreen(process.cwd(), "tests/fixtures/screens"), /No file at/);
  const base = scratch({ "superwall/package.json": "{}", "App/A.swift": "import SwiftUI\nstruct A: View {}" });
  const screen = readScreen(path.join(base, "superwall"), path.join(base, "App", "A.swift"));
  assert.equal(screen.path, "../App/A.swift");
  assert.equal(screen.file, path.join(base, "App", "A.swift"));
});

test("candidates are ranked by name and content signals, skipping tests, huge and shapeless files", () => {
  const root = scratch({
    "App/UpdateRequiredView.swift": fs.readFileSync(path.join(FIXTURES, "UpdateRequiredView.swift"), "utf8"),
    "App/Settings/RateUsSheet.swift": 'import SwiftUI\nstruct RateUsSheet: View { var body: some View { Text("Rate") } }',
    "App/Photos/ImagePreviewScreen.swift": 'import SwiftUI\nstruct ImagePreviewScreen: View { var body: some View { Text("Preview") } }',
    "App/Models/UpdatePolicy.swift": "struct UpdatePolicy { let minimum: String }",
    "App/Helpers.swift": "func helper() {}",
    "AppTests/UpdateRequiredViewTests.swift": "import SwiftUI\nstruct T: View {}",
    "App/Huge.swift": `import SwiftUI\nstruct Huge: View {}${"\n// pad".repeat(60_000)}`,
    "superwall/paywalls/update-required/app/index.tsx": "export default () => <div>Update</div>",
    "node_modules/x/UpdateScreen.tsx": "export const A = () => <View />",
  });
  const found = findScreenCandidates(root, 3);
  assert.deepEqual(
    found.map((candidate) => candidate.path),
    ["App/UpdateRequiredView.swift", "App/Settings/RateUsSheet.swift"],
  );
  assert.equal(found[0]?.framework, "swiftui");
  assert.equal(found[0]?.name, "Update Required");
  assert.match(found[0]?.reason ?? "", /named like an update-required screen; links to the app store/);
  assert.match(found[1]?.reason ?? "", /rate-us/);
  assert.deepEqual(findScreenCandidates(scratch({ "README.md": "# hi" })), []);
});

test("candidates whose framework cannot be told are left out", () => {
  const root = scratch({
    "App/UpdateBanner.tsx": "export const x = 1",
  });
  assert.deepEqual(findScreenCandidates(root), []);
});

test("config.ts carries the name and one slot per product, keyed by the last segment", () => {
  const screen = readScreen(process.cwd(), "tests/fixtures/screens/UpdateRequiredView.swift");
  assert.equal(
    screenConfigSource(screen),
    'import { definePaywall } from "superwall/config";\n\nexport default definePaywall({\n  name: "Update Required",\n  products: {\n    annual: "com.acme.pro.annual",\n  },\n});\n',
  );
  const none = readScreen(process.cwd(), "tests/fixtures/screens/LegacyUpdateViewController.swift");
  assert.doesNotMatch(screenConfigSource(none), /products/);

  const clashing = {
    ...screen,
    inventory: { ...screen.inventory, productIds: ["com.acme.annual", "com.acme.pro.annual", "12.annual", "9.9"] },
  };
  assert.match(screenConfigSource(clashing), /annual: "com.acme.annual",\n\s+annual2: "com.acme.pro.annual",\n\s+annual3: "12.annual",\n\s+product: "9.9"/);
});

test("the brief lists everything found and maps each action to a hook", () => {
  const screen = readScreen(process.cwd(), "tests/fixtures/screens/UpdateRequiredView.swift");
  const brief = screenBrief(screen, "original.png");
  assert.match(brief, /^# Migrating "Update Required" to Superwall/);
  assert.match(brief, /File: `tests\/fixtures\/screens\/UpdateRequiredView.swift` \(SwiftUI\)/);
  assert.match(brief, /Screenshot of the original: `original.png`/);
  assert.match(brief, /register in the app: `update_required`/);
  assert.match(brief, /\| 1 \| Update required \|/);
  assert.match(brief, /Dynamic values in that copy: `minimumVersion`/);
  assert.match(brief, /- `rocket`/);
  assert.match(brief, /System symbols: `arrow.down.circle.fill`/);
  assert.match(brief, /- `https:\/\/apps.apple.com\/app\/id123456789`/);
  assert.match(brief, /- `com.acme.pro.annual`/);
  assert.match(brief, /\| opening a URL \(App Store links included\) \| ×2 \| `useActions\(\).openUrl\(url\)` \|/);
  assert.match(brief, /`useActions\(\).requestStoreReview\(\)`/);

  const bare = screenBrief(readScreen(process.cwd(), "tests/fixtures/screens/LegacyUpdateViewController.swift"));
  assert.match(bare, /Screenshot of the original: none — take one/);
  assert.match(bare, /_No store product identifiers found; this screen sells nothing._/);
  assert.match(bare, /_No URLs._/.test(bare) ? /_No URLs._/ : /apps.apple.com/);
  assert.doesNotMatch(bare, /Dynamic values/);
  assert.doesNotMatch(bare, /System symbols/);

  const empty = screenBrief({
    ...screen,
    inventory: { copy: [], interpolations: [], assets: [], symbols: [], urls: [], productIds: [], actions: [] },
  });
  assert.match(empty, /_No user-visible strings were found/);
  assert.match(empty, /_No image or media assets referenced._/);
  assert.match(empty, /_No URLs._/);
  assert.match(empty, /_No actions were detected/);
});

test("a UIKit controller pulls in its view, view model and storyboard scene as companions", () => {
  const root = scratch({
    "App/Alerts/ViewController/RequiredUpdateScreen.swift": [
      "import UIKit",
      "class RequiredUpdateScreen: UIViewController {",
      "  lazy var mainView: RequiredUpdateView = { self.view as! RequiredUpdateView }()",
      "  lazy var model: RequireUpdateViewModel = RequireUpdateViewModel()",
      "  func go() { UIApplication.shared.open(URL(string: model.link)!) }",
      "}",
    ].join("\n"),
    "App/Alerts/View/RequiredUpdateView.swift": [
      "import UIKit",
      "class RequiredUpdateView: UIView {",
      '  func configure() { titleLabel.text = "Update required"; button.setTitle("Update now", for: .normal) }',
      "}",
    ].join("\n"),
    "App/Alerts/ViewModel/RequireUpdateViewModel.swift": 'class RequireUpdateViewModel { let title = "Time to update" }',
    "App/Alerts/Alerts.storyboard": [
      '<document><scenes>',
      '<scene sceneID="a"><objects><viewController customClass="OtherScreen"><label text="Not this one"/></viewController></objects></scene>',
      '<scene sceneID="b"><objects><viewController customClass="RequiredUpdateScreen"><view customClass="RequiredUpdateView">',
      '<label text="A new version is available &amp; required"/><imageView image="rocket"/><imageView image="arrow.down" catalog="system"/>',
      '<button><state key="normal" title="Later"/></button><button><state key="normal" title="Update"/></button>',
      "</view></viewController></objects></scene>",
      "</scenes></document>",
    ].join("\n"),
    "App/Other/Unrelated.xib": '<document><view customClass="Nope"><label text="Nope"/></view></document>',
  });
  const screen = readScreen(
    path.join(root, "superwall"),
    path.join(root, "App/Alerts/ViewController/RequiredUpdateScreen.swift"),
    root,
  );
  assert.equal(screen.framework, "uikit");
  assert.deepEqual(screen.companions, [
    "../App/Alerts/Alerts.storyboard",
    "../App/Alerts/View/RequiredUpdateView.swift",
    "../App/Alerts/ViewModel/RequireUpdateViewModel.swift",
  ]);
  assert.deepEqual(screen.inventory.copy, [
    "A new version is available & required",
    "Later",
    "Update",
    "Update required",
    "Update now",
    "Time to update",
  ]);
  assert.deepEqual(screen.inventory.assets, ["rocket"]);
  assert.deepEqual(screen.inventory.symbols, ["arrow.down"]);
  assert.deepEqual(kinds(screen), { "open-url": 1, tap: 2 });
  assert.match(screenBrief(screen), /Also read \(what this screen draws from[^\n]*`\.\.\/App\/Alerts\/Alerts.storyboard`, `\.\.\/App\/Alerts\/View\/RequiredUpdateView.swift`/);

  const alone = readScreen(path.join(root, "superwall"), path.join(root, "App/Alerts/ViewController/RequiredUpdateScreen.swift"));
  assert.deepEqual(alone.companions, []);
  assert.deepEqual(alone.inventory.copy, []);
});

test("a xib is read whole, and a SwiftUI view only picks up Swift companions", () => {
  const xib = scanInterfaceBuilder(
    '<document><view><label text="Hello &quot;there&quot;"/><textField placeholder="Email"/><imageView image="hero"/><button><state key="normal" title="Go"/></button></view></document>',
    ["Anything"],
  );
  assert.deepEqual(xib.copy, ['Hello "there"', "Email", "Go"]);
  assert.deepEqual(xib.assets, ["hero"]);
  assert.deepEqual(xib.actions, [{ kind: "tap", count: 1 }]);

  const root = scratch({
    "App/RateUsView.swift": 'import SwiftUI\nstruct RateUsView: View { let model = RateUsModel(); var body: some View { Text("Rate us") } }',
    "App/RateUsModel.swift": 'struct RateUsModel { let prompt = "Enjoying the app?" }',
    "App/Rate.storyboard": '<document><scene><objects><viewController customClass="RateUsView"><label text="Ignored for SwiftUI? No: read"/></viewController></objects></scene></document>',
  });
  const screen = readScreen(path.join(root, "superwall"), path.join(root, "App/RateUsView.swift"), root);
  assert.deepEqual(screen.companions, ["../App/Rate.storyboard", "../App/RateUsModel.swift"]);
  assert.deepEqual(screen.inventory.copy, ["Rate us", "Ignored for SwiftUI? No: read", "Enjoying the app?"]);

  const rn = scratch({ "src/RateUsScreen.tsx": "export const RateUsScreen = () => <View><RateUsModel /></View>", "src/RateUsModel.swift": "class RateUsModel {}" });
  assert.deepEqual(readScreen(path.join(rn, "superwall"), path.join(rn, "src/RateUsScreen.tsx"), rn).companions, []);
});

test("a Compose screen yields its text, resources, icons, link, product and actions", () => {
  const screen = readScreen(process.cwd(), "tests/fixtures/screens/UpdateRequiredScreen.kt");
  assert.equal(screen.framework, "compose");
  assert.equal(screen.name, "Update Required");
  assert.deepEqual(screen.inventory.copy, [
    "Rocket",
    "Version $minimumVersion fixes sign-in. Update to keep using Acme.",
    "Update now",
    "Remind me later",
  ]);
  assert.deepEqual(screen.inventory.interpolations, ["minimumVersion"]);
  assert.deepEqual(screen.inventory.assets, ["rocket"]);
  assert.deepEqual(screen.inventory.symbols, ["SystemUpdate"]);
  assert.deepEqual(screen.inventory.urls, ["https://play.google.com/store/apps/details?id=com.acme.app"]);
  assert.deepEqual(screen.inventory.productIds, ["acme_pro_annual"]);
  assert.deepEqual(kinds(screen), { "open-url": 1, tap: 2 });
  assert.match(screenBrief(screen), /\(Jetpack Compose\)/);
});

test("an Android Views screen resolves its layout and strings.xml as companions", () => {
  const root = scratch({
    "app/src/main/java/com/acme/UpdateRequiredActivity.kt": [
      "package com.acme",
      "import android.os.Bundle",
      "class UpdateRequiredActivity : AppCompatActivity() {",
      "  override fun onCreate(savedInstanceState: Bundle?) {",
      "    super.onCreate(savedInstanceState)",
      "    setContentView(R.layout.activity_update_required)",
      "    title = getString(R.string.update_title)",
      "    findViewById<Button>(R.id.update).setOnClickListener { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(model.link))) }",
      "    findViewById<Button>(R.id.later).setOnClickListener { finish() }",
      "  }",
      "}",
    ].join("\n"),
    "app/src/main/res/layout/activity_update_required.xml": [
      '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" xmlns:app="http://schemas.android.com/apk/res-auto">',
      '  <ImageView android:contentDescription="@string/rocket_description" app:srcCompat="@drawable/system_update_icon"/>',
      '  <TextView android:text="@string/update_title"/>',
      '  <TextView android:text="@string/update_body"/>',
      '  <TextView android:text="Hardcoded subtitle"/>',
      '  <Button android:id="@+id/update" android:text="@string/update_now"/>',
      '  <Button android:id="@+id/later" android:text="@string/later"/>',
      "</LinearLayout>",
    ].join("\n"),
    "app/src/main/res/values/strings.xml": [
      "<resources>",
      '  <string name="update_title">Update required</string>',
      '  <string name="update_body">Version %1$s fixes sign-in &amp; sync.</string>',
      '  <string name="update_now">Update now</string>',
      '  <string name="later">Remind me later</string>',
      '  <string name="rocket_description">Rocket</string>',
      "</resources>",
    ].join("\n"),
    "app/src/main/res/layout/activity_other.xml": '<TextView android:text="Not this screen"/>',
  });
  const screen = readScreen(
    path.join(root, "superwall"),
    path.join(root, "app/src/main/java/com/acme/UpdateRequiredActivity.kt"),
    root,
  );
  assert.equal(screen.framework, "android-views");
  assert.equal(screen.name, "Update Required");
  assert.deepEqual(screen.companions, [
    "../app/src/main/res/layout/activity_update_required.xml",
    "../app/src/main/res/values/strings.xml",
  ]);
  assert.deepEqual(screen.inventory.copy, [
    "Update required",
    "Rocket",
    "Version %1$s fixes sign-in & sync.",
    "Hardcoded subtitle",
    "Update now",
    "Remind me later",
  ]);
  assert.deepEqual(screen.inventory.assets, ["system_update_icon"]);
  assert.deepEqual(kinds(screen), { "open-url": 1, dismiss: 1, tap: 4 });
  assert.match(screenBrief(screen), /\(Android Views\)/);
  assert.match(screenBrief(screen), /Also read[^\n]*activity_update_required\.xml/);

  const model = scanScreen("class UpdateModel { val x = 1 }", "android-views");
  assert.deepEqual(model.copy, []);
  assert.throws(() => screenFrameworkOf("Model.kt", "class UpdateModel { val x = 1 }"), /no Composable, Activity or Fragment/);
});

const asRoot = process.getuid?.() === 0;

test("a comment that runs to the end of the file hides what follows it", () => {
  const line = scanScreen('import SwiftUI\nstruct A: View { var body: some View { Text("Hi there") } } // Text("not this")', "swiftui");
  assert.deepEqual(line.copy, ["Hi there"]);

  const block = scanScreen('import SwiftUI\nstruct A: View { var body: some View { Text("Hi there") } } /* Text("nor this")', "swiftui");
  assert.deepEqual(block.copy, ["Hi there"]);
});

test("JSX text with words in it is copy even when it starts like a format string", () => {
  const inventory = scanScreen("export const A = () => <Text>%d days left</Text>;", "react-native");
  assert.deepEqual(inventory.copy, ["%d days left"]);
});

test("a dotted identifier in a product context is a product, and a phrase there is copy", () => {
  const inventory = scanScreen(
    'import SwiftUI\nstruct A: View {\n  let product = "Pro.Annual"\n  let plan = "Best value"\n  var body: some View { Text("x") }\n}',
    "swiftui",
  );
  assert.deepEqual(inventory.productIds, ["Pro.Annual"]);
  assert.deepEqual(inventory.copy, ["Best value", "x"]);
});

test("a system image is a symbol whichever attribute comes first", () => {
  const xib = scanInterfaceBuilder(
    '<document><view><imageView image="star.fill" catalog="system"/><imageView catalog="system" image="bolt"/><imageView image="hero"/></view></document>',
    ["Anything"],
  );
  assert.deepEqual(xib.symbols, ["star.fill", "bolt"]);
  assert.deepEqual(xib.assets, ["hero"]);
  assert.deepEqual(xib.actions, []);
});

test("an Interface Builder file that is too big or unreadable is not a companion", { skip: asRoot }, () => {
  const scene = '<document><viewController customClass="UpgradeScreen"><label text="Upgrade today"/></viewController></document>';
  const root = scratch({
    "App/UpgradeScreen.swift": "import UIKit\nclass UpgradeScreen: UIViewController {}",
    "App/Upgrade.storyboard": scene,
    "App/Huge.storyboard": `${scene}${" ".repeat(1_000_001)}`,
    "App/Locked.xib": scene,
  });
  fs.chmodSync(path.join(root, "App/Locked.xib"), 0o000);

  const screen = readScreen(path.join(root, "superwall"), path.join(root, "App/UpgradeScreen.swift"), root);

  assert.deepEqual(screen.companions, ["../App/Upgrade.storyboard"]);
  assert.deepEqual(screen.inventory.copy, ["Upgrade today"]);
});

test("a Compose screen pulls in its view model and the strings it reads, without a layout", () => {
  const root = scratch({
    "app/src/main/java/com/acme/PaywallScreen.kt": [
      "@Composable",
      "fun PaywallScreen(model: PaywallViewModel, row: PlanRowView) {",
      "  Text(stringResource(R.string.paywall_title))",
      "  Button(onClick = { model.buy() }) { Text(\"Start trial\") }",
      "}",
    ].join("\n"),
    "app/src/main/java/com/acme/PaywallViewModel.kt": [
      "class PaywallViewModel {",
      "  val headline = stringResource(R.string.paywall_headline)",
      "  fun buy() { billingClient.launchBillingFlow(activity, params) }",
      "}",
    ].join("\n"),
    "app/src/main/java/com/acme/PlanRowView.kt": 'class PlanRowView { val label = "Not a companion" }',
    "app/src/main/res/values/strings.xml": [
      "<resources>",
      '  <string name="paywall_title">Go \\\'Pro\\\'</string>',
      '  <string name="paywall_headline">"Unlock everything"</string>',
      "</resources>",
    ].join("\n"),
  });

  const screen = readScreen(path.join(root, "superwall"), path.join(root, "app/src/main/java/com/acme/PaywallScreen.kt"), root);

  assert.equal(screen.framework, "compose");
  assert.deepEqual(screen.companions, [
    "../app/src/main/java/com/acme/PaywallViewModel.kt",
    "../app/src/main/res/values/strings.xml",
  ]);
  assert.deepEqual(screen.inventory.copy, ["Start trial", "Go 'Pro'", "Unlock everything"]);
  assert.deepEqual(kinds(screen), { purchase: 1, tap: 1 });
});

test("a layout's bound expressions are not copy, and a layout without buttons adds no taps", () => {
  const root = scratch({
    "app/src/main/java/com/acme/WelcomeActivity.kt": [
      "class WelcomeActivity : AppCompatActivity() {",
      "  override fun onCreate(state: Bundle?) { setContentView(R.layout.activity_welcome) }",
      "}",
    ].join("\n"),
    "app/src/main/res/layout/activity_welcome.xml": [
      "<LinearLayout>",
      '  <TextView android:text="@{viewModel.title}"/>',
      '  <TextView android:text="@string/missing"/>',
      '  <TextView android:text="Welcome aboard"/>',
      "</LinearLayout>",
    ].join("\n"),
    "app/src/main/res/values/strings.xml": "<resources></resources>",
  });

  const screen = readScreen(path.join(root, "superwall"), path.join(root, "app/src/main/java/com/acme/WelcomeActivity.kt"), root);

  assert.deepEqual(screen.inventory.copy, ["Welcome aboard"]);
  assert.deepEqual(screen.inventory.actions, []);
});

test("a strings.xml that cannot be read fails the read instead of dropping its copy", { skip: asRoot }, () => {
  const root = scratch({
    "app/src/main/java/com/acme/WelcomeScreen.kt": "@Composable\nfun WelcomeScreen() { Text(stringResource(R.string.title)) }",
    "app/src/main/res/values/strings.xml": '<resources><string name="title">Welcome</string></resources>',
  });
  fs.chmodSync(path.join(root, "app/src/main/res/values/strings.xml"), 0o000);

  assert.throws(
    () => readScreen(path.join(root, "superwall"), path.join(root, "app/src/main/java/com/acme/WelcomeScreen.kt"), root),
    /EACCES/,
  );
});

test("candidates skip unreadable files and Swift views of no known framework, and tie by path", { skip: asRoot }, () => {
  const root = scratch({
    "App/PaywallView.swift": "import SwiftUI\nstruct PaywallView: View {}",
    "App/OfferView.swift": "import SwiftUI\nstruct OfferView: View {}",
    "App/UpgradeView.swift": "struct UpgradeView: View {}",
    "App/LockedUpdateView.swift": "import SwiftUI\nstruct LockedUpdateView: View {}",
  });
  fs.chmodSync(path.join(root, "App/LockedUpdateView.swift"), 0o000);

  assert.deepEqual(
    findScreenCandidates(root).map((candidate) => candidate.path),
    ["App/OfferView.swift", "App/PaywallView.swift"],
  );
});

test("an Android screen that reads no strings and names no layout has no companions", () => {
  const root = scratch({
    "app/src/main/java/com/acme/RateScreen.kt": '@Composable\nfun RateScreen() { Text("Enjoying Acme?") }',
    "app/src/main/res/values/strings.xml": '<resources><string name="title">Unused</string></resources>',
  });

  const screen = readScreen(path.join(root, "superwall"), path.join(root, "app/src/main/java/com/acme/RateScreen.kt"), root);

  assert.deepEqual(screen.companions, []);
  assert.deepEqual(screen.inventory.copy, ["Enjoying Acme?"]);
});

test("each framework has a label for the brief and the terminal", () => {
  const frameworks: ScreenFramework[] = ["swiftui", "uikit", "compose", "android-views", "react-native", "flutter"];
  assert.deepEqual(frameworks.map(screenFrameworkLabel), [
    "SwiftUI",
    "UIKit",
    "Jetpack Compose",
    "Android Views",
    "React Native",
    "Flutter",
  ]);
});
