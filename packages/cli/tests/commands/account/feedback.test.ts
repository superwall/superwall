import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { runFeedback } from "@/commands/account/feedback";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";
import { run } from "../../helpers/command";

afterEach(() => {
  restoreFetch();
  clearHomes();
  process.exitCode = undefined;
});

test("sends the message an agent passed on the command line", async () => {
  useHome({ userEmail: "dev@example.com" });
  const log = useFetch([{ match: "/capture/", body: { status: 1 } }]);

  const result = await run(runFeedback.definition, { argv: { message: "  dev is great  " } });

  const sent = JSON.parse(String(log[0]?.body)) as {
    event: string;
    properties: { message: string; via: string; email: string };
  };
  assert.equal(sent.event, "feedback submitted");
  assert.equal(sent.properties.message, "dev is great");
  assert.equal(sent.properties.via, "agent");
  assert.equal(sent.properties.email, "dev@example.com");
  assert.match(result.said("success").join(), /Thank you/);
});

test("asks for the message when someone is there to type it", async () => {
  useHome();
  useFetch([{ match: "/capture/", body: {} }]);
  const calls: RendererCall[] = [];
  const renderer = { ...recordingRenderer(calls), text: async () => "  the picker is confusing  " };

  await run(runFeedback.definition, { interactive: true, renderer });

  assert.match(calls.map((call) => call.method).join(","), /intro/);
  assert.match(
    calls
      .filter((call) => call.method === "success")
      .map((call) => String(call.value))
      .join(),
    /Thank you/,
  );
});

test("a cancelled prompt sends nothing", async () => {
  useHome();
  const log = useFetch([{ match: "/capture/", body: {} }]);
  const calls: RendererCall[] = [];
  const renderer = { ...recordingRenderer(calls), text: async () => null };

  await run(runFeedback.definition, { interactive: true, renderer });

  assert.equal(log.length, 0);
  assert.match(
    calls
      .filter((call) => call.method === "warn")
      .map((call) => String(call.value))
      .join(),
    /Cancelled/,
  );
});

test("no message and nobody to ask says how to pass one", async () => {
  useHome();

  const result = await run(runFeedback.definition);

  assert.match(result.said("error").join(), /Usage: superwall feedback/);
  assert.equal(process.exitCode, 1);
});

test("a refused send is an error, and --json says so as data", async () => {
  useHome();
  useFetch([{ match: "/capture/", status: 500, body: {} }]);

  const result = await run(runFeedback.definition, { argv: { message: "nope" } });
  assert.match(result.said("error").join(), /check your connection/);

  useFetch([{ match: "/capture/", status: 500, body: {} }]);
  const asJson = await run(runFeedback.definition, { argv: { message: "nope", json: true } });
  assert.deepEqual(asJson.json, { submitted: false });
});

test("a full agent report carries its title, kind, ids and repro context", async () => {
  useHome({ userEmail: "dev@example.com" });
  const log = useFetch([{ match: "/capture/", body: { status: 1 } }]);

  await run(runFeedback.definition, {
    argv: {
      message: "push 413s on a 2MB asset",
      title: "push 413",
      kind: "bug",
      command: "superwall push",
      app: "1128",
      context: ["paywall=pw_abc", "sdk=expo@3.1.0"],
      agent: "codex",
      json: true,
    },
  });

  const { properties } = JSON.parse(String(log[0]?.body)) as {
    properties: Record<string, unknown>;
  };
  assert.equal(properties.title, "push 413");
  assert.equal(properties.kind, "bug");
  assert.equal(properties.command, "superwall push");
  assert.equal(properties.application_id, "1128");
  assert.deepEqual(properties.context, { paywall: "pw_abc", sdk: "expo@3.1.0" });
  assert.equal(properties.agent, "codex");
  assert.equal(properties.via, "agent");
  assert.equal(properties.org_id, undefined);
});
