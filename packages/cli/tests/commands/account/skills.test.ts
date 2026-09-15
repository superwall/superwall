import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { runSkills } from "@/commands/account/skills";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";
import { restoreBin, useBin } from "../../helpers/bin";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";
import { run } from "../../helpers/command";

const GITHUB = "api.github.com";

afterEach(() => {
  restoreFetch();
  restoreBin();
  clearHomes();
  process.exitCode = undefined;
});

test("a dry run prints the npx commands it would run and installs nothing", async () => {
  useHome();
  useFetch([{ match: GITHUB, body: [] }]);

  const result = await run(runSkills.definition, { argv: { dryRun: true } });

  const commands = result.said("info").filter((line) => line.startsWith("npx"));
  assert.equal(commands.length, 2);
  assert.match(commands[0] ?? "", /--copy$/);
  assert.match(commands[1] ?? "", /^npx -y skills@latest add superwall\/skills --global --yes/);
  assert.match(result.said("spinner.stop").join(), /Dry run/);
});

test("named skills are installed by name, not all of them", async () => {
  useHome();
  useFetch([{ match: GITHUB, body: [] }]);

  const result = await run(runSkills.definition, {
    argv: { dryRun: true, skill: ["superwall-framework", "superwall"] },
  });

  assert.match(
    result.said("info").join("\n"),
    /--skill superwall-framework superwall/,
  );
});

test("one named skill is as good as a list", async () => {
  useHome();
  useFetch([{ match: GITHUB, body: [] }]);

  const result = await run(runSkills.definition, { argv: { dryRun: true, skill: "superwall" } });

  assert.match(result.said("info").join("\n"), /--skill superwall$/m);
});

test("skills already current are left alone unless forced", async () => {
  useHome();
  useFetch([{ match: GITHUB, body: { sha: "abc" } }]);
  useBin({ npx: "exit 0" });

  const fresh = await run(runSkills.definition, { argv: { force: true, yes: true } });
  assert.match(fresh.said("spinner.stop").join(), /Skills installed for every detected agent/);

  const second = await run(runSkills.definition, { argv: { yes: true } });
  assert.match(second.said("success").join(), /already up to date/);
  assert.match(second.said("outro").join(), /--force` to reinstall/);
});

test("a failed install is an error that names the likely cause", async () => {
  useHome();
  useFetch([{ match: GITHUB, body: { sha: "abc" } }]);
  useBin({ npx: "echo 'no npx here' >&2; exit 1" });

  const result = await run(runSkills.definition, { argv: { force: true, yes: true } });

  assert.match(result.said("error").join(), /Skill installation failed/);
  assert.equal(process.exitCode, 1);
});

test("the picker offers what the public repo has, and installs the chosen ones", async () => {
  useHome();
  useFetch([
    {
      match: GITHUB,
      body: [
        { name: "superwall", type: "dir" },
        { name: "superwall-framework", type: "dir" },
      ],
    },
  ]);
  useBin({ npx: "exit 0" });
  const calls: RendererCall[] = [];
  const renderer = {
    ...recordingRenderer(calls),
    multiselect: async (value: unknown) => {
      calls.push({ method: "multiselect", value });
      return ["superwall-framework"];
    },
  };

  await run(runSkills.definition, { interactive: true, renderer });

  const offered = calls.find((call) => call.method === "multiselect")?.value as
    | { options: { value: string }[] }
    | undefined;
  assert.ok(offered, `no picker; saw ${calls.map((call) => call.method).join(",")}`);
  assert.deepEqual(offered.options.map((option) => option.value).sort(), [
    "superwall",
    "superwall-framework",
  ]);
});

test("choosing nothing in the picker installs nothing", async () => {
  useHome();
  useFetch([{ match: GITHUB, body: [{ name: "superwall", type: "dir" }] }]);
  const calls: RendererCall[] = [];
  const renderer = {
    ...recordingRenderer(calls),
    multiselect: async (value: unknown) => {
      calls.push({ method: "multiselect", value });
      return [];
    },
  };

  await run(runSkills.definition, { interactive: true, renderer });

  assert.match(
    calls
      .filter((call) => call.method === "warn")
      .map((call) => String(call.value))
      .join(),
    /Nothing selected/,
  );
});
