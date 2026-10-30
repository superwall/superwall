import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCommitMessage, redact, tokenSecret } from "@/core/paywalls/source/commit";

const BASE = {
  kind: "paywall" as const,
  surface: "plus-upgrade",
  version: 7,
  paywallId: "208540",
  applicationId: "42",
  framework: "0.4.2",
};

test("the commit message is byte-identical to the one the platform writes", () => {
  assert.equal(
    buildCommitMessage(BASE),
    "publish paywall/plus-upgrade v7\n" +
      "\n" +
      "Superwall-Paywall: 208540\n" +
      "Superwall-Application: 42\n" +
      "Superwall-Version: 7\n" +
      "Superwall-Surface: paywall/plus-upgrade\n" +
      "Superwall-Portable: true\n" +
      "Superwall-Framework: 0.4.2\n",
  );
});

test("snapshot and cli trailers appear in their fixed slots when present", () => {
  assert.equal(
    buildCommitMessage({ ...BASE, snapshotSha: "abc123", cli: "1.0.0" }),
    "publish paywall/plus-upgrade v7\n" +
      "\n" +
      "Superwall-Paywall: 208540\n" +
      "Superwall-Application: 42\n" +
      "Superwall-Version: 7\n" +
      "Superwall-Surface: paywall/plus-upgrade\n" +
      "Superwall-Portable: true\n" +
      "Superwall-Snapshot: abc123\n" +
      "Superwall-Framework: 0.4.2\n" +
      "Superwall-Cli: 1.0.0\n",
  );
});

test("a note becomes the body, normalized and trimmed", () => {
  assert.equal(
    buildCommitMessage({ ...BASE, note: "  Ship it\r\n\r\nBecause reasons.  " }),
    "publish paywall/plus-upgrade v7\n" +
      "\n" +
      "Ship it\n" +
      "\n" +
      "Because reasons.\n" +
      "\n" +
      "Superwall-Paywall: 208540\n" +
      "Superwall-Application: 42\n" +
      "Superwall-Version: 7\n" +
      "Superwall-Surface: paywall/plus-upgrade\n" +
      "Superwall-Portable: true\n" +
      "Superwall-Framework: 0.4.2\n",
  );
});

test("a whitespace-only note is treated as no note at all", () => {
  assert.equal(buildCommitMessage({ ...BASE, note: "   \n  " }), buildCommitMessage(BASE));
});

test("a funnel says so in both the subject and the surface trailer", () => {
  const message = buildCommitMessage({ ...BASE, kind: "funnel", surface: "onboarding" });
  assert.match(message, /^publish funnel\/onboarding v7\n/);
  assert.match(message, /Superwall-Surface: funnel\/onboarding\n/);
});

const parseCommitTrailers = (message: string): Record<string, string> => {
  const paragraphs = message.trimEnd().split("\n\n");
  const last = paragraphs.at(-1) ?? "";
  const trailers: Record<string, string> = {};
  for (const line of last.split("\n")) {
    const match = /^([A-Za-z][A-Za-z0-9-]*): *(.*)$/.exec(line);
    if (!match || (match[2] ?? "").trim() === "") return {};
    trailers[match[1] ?? ""] = (match[2] ?? "").trim();
  }
  return trailers;
};

test("a fully contained project is recorded as portable", () => {
  const trailers = parseCommitTrailers(buildCommitMessage(BASE));

  assert.equal(trailers["Superwall-Portable"], "true");
  assert.equal("Superwall-External" in trailers, false);
});

test("out-of-tree imports flip portable and are listed in order", () => {
  const trailers = parseCommitTrailers(
    buildCommitMessage({ ...BASE, external: ["../src/theme.ts", "../packages/ui/index.tsx"] }),
  );

  assert.equal(trailers["Superwall-Portable"], "false");
  assert.equal(trailers["Superwall-External"], "../src/theme.ts, ../packages/ui/index.tsx");
});

test("an empty external list emits no trailer rather than an empty one", () => {
  for (const external of [[], [""], ["   "], ["", "  "]]) {
    const message = buildCommitMessage({ ...BASE, external });

    assert.ok(!message.includes("Superwall-External"), `emitted for ${JSON.stringify(external)}`);
    assert.equal(parseCommitTrailers(message)["Superwall-Portable"], "true");
  }
});

test("no input can construct an empty-value trailer — the whole block would be void", () => {
  const messages = [
    buildCommitMessage(BASE),
    buildCommitMessage({ ...BASE, external: [] }),
    buildCommitMessage({ ...BASE, external: ["", " "] }),
    buildCommitMessage({ ...BASE, external: ["../a.ts"] }),
    buildCommitMessage({ ...BASE, snapshotSha: "abc", cli: "1.0.0", note: "why" }),
    buildCommitMessage({ ...BASE, kind: "funnel", surface: "onboarding", external: ["../a.ts"] }),
  ];

  for (const message of messages) {
    const trailers = parseCommitTrailers(message);
    assert.notDeepEqual(trailers, {}, `parser rejected the block in:\n${message}`);
    for (const [key, value] of Object.entries(trailers)) {
      assert.notEqual(value, "", `${key} came out empty in:\n${message}`);
    }
    assert.ok(trailers["Superwall-Paywall"], "identity trailers must survive the round trip");
  }
});

test("a note never bleeds into the trailer block", () => {
  const trailers = parseCommitTrailers(
    buildCommitMessage({ ...BASE, note: "Ship it\n\nBecause reasons.", external: ["../a.ts"] }),
  );

  assert.equal(trailers["Superwall-External"], "../a.ts");
  assert.equal("Because reasons." in trailers, false);
});

test("tokenSecret keeps only the part git can authenticate with", () => {
  assert.equal(tokenSecret("art_v1_deadbeefcafe?expires=1790000000"), "art_v1_deadbeefcafe");
  assert.equal(tokenSecret("art_v1_nosuffix"), "art_v1_nosuffix");
});

test("redact removes every form of the token from text a user could see", () => {
  const token = "art_v1_deadbeefcafe?expires=1790000000";
  const message = `fatal: auth failed for ${token} using ${tokenSecret(token)}`;

  const safe = redact(message, token, tokenSecret(token));
  assert.ok(!safe.includes("deadbeefcafe"));
  assert.ok(!safe.includes(tokenSecret(token)));
  assert.match(safe, /fatal: auth failed/);
});

test("redact leaves short strings alone rather than blanking the message", () => {
  assert.equal(redact("nothing to hide", "abc"), "nothing to hide");
});

test("a project source commit names the app and framework, with the note as its body", () => {
  assert.equal(
    buildCommitMessage({ kind: "project", applicationId: "42", framework: "0.4.2", cli: "2.0.0", note: " Rounder\r\ncorners " }),
    "publish project source\n\nRounder\ncorners\n\nSuperwall-Application: 42\nSuperwall-Framework: 0.4.2\nSuperwall-Cli: 2.0.0\n",
  );
  assert.equal(
    buildCommitMessage({ kind: "project", applicationId: "42", framework: "0.4.2" }),
    "publish project source\n\nSuperwall-Application: 42\nSuperwall-Framework: 0.4.2\n",
  );
});
