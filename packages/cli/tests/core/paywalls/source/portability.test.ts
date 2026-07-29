import assert from "node:assert/strict";
import { test } from "node:test";
import { portabilityWarning } from "@/core/paywalls/source/portability";

test("a self-contained project gets no warning at all", () => {
  assert.equal(portabilityWarning([]), undefined);
  assert.equal(portabilityWarning(["", "   "]), undefined);
});

test("one offender reads in the singular and is named", () => {
  const message = portabilityWarning(["../src/theme.ts"]);

  assert.match(message ?? "", /^1 import resolves outside superwall\/ \(\.\.\/src\/theme\.ts\)/);
});

test("several offenders read in the plural, sorted and deduped", () => {
  const message = portabilityWarning([
    "../src/theme.ts",
    "../packages/ui/index.tsx",
    "../src/theme.ts",
  ]);

  assert.match(
    message ?? "",
    /^2 imports resolve outside superwall\/ \(\.\.\/packages\/ui\/index\.tsx, \.\.\/src\/theme\.ts\)/,
  );
});

test("the warning says what is lost and what to do about it", () => {
  const message = portabilityWarning(["../src/theme.ts"]) ?? "";

  assert.match(message, /edited locally only/);
  assert.match(message, /remote editing and rebuilds won't be available/);
  assert.match(message, /move them into superwall\/components\/ or install from a package registry/);
});

test("a long list is capped so the warning stays readable", () => {
  const many = Array.from({ length: 9 }, (_, index) => `../src/f${index}.ts`);
  const message = portabilityWarning(many) ?? "";

  assert.match(message, /^9 imports resolve/);
  assert.match(message, /and 4 more/);
  assert.equal(message.includes("../src/f5.ts"), false);
});

test("exactly five offenders are all shown, with no 'and more'", () => {
  const message = portabilityWarning(Array.from({ length: 5 }, (_, i) => `../src/f${i}.ts`)) ?? "";

  assert.match(message, /\.\.\/src\/f4\.ts\)/);
  assert.equal(message.includes("more"), false);
});

test("it is one message however many surfaces contributed", () => {
  const fromTwoSurfaces = ["../src/theme.ts", "../src/theme.ts", "../src/tokens.ts"];
  const message = portabilityWarning(fromTwoSurfaces) ?? "";

  assert.equal(message.split("import").length - 1, 1);
  assert.match(message, /^2 imports resolve/);
});
