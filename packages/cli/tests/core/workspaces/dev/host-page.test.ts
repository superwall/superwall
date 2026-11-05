import assert from "node:assert/strict";
import { test } from "node:test";
import { renderHostPage, WATCH_LOAD } from "@/core/workspaces/dev/host-page";
import { BRIDGE_PROTOCOL, MOUNT_LOAD_TIMEOUT_MS } from "@/core/workspaces/wire";

test("the host page speaks the bridge the frame expects", () => {
  const page = renderHostPage();
  assert.ok(page.includes(BRIDGE_PROTOCOL));
  for (const message of ['"connect"', '"theme"', '"visibility"', '"resize"', '"ready"']) {
    assert.ok(page.includes(message), message);
  }
  assert.ok(page.includes("allow-scripts allow-same-origin allow-forms allow-popups"));
  new Function(page.slice(page.indexOf("<script>") + 8, page.lastIndexOf("</script>")));
});

function hiddenPage(ready = () => false) {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: "visible",
    addEventListener: (_: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => void listeners.delete(listener),
  };
  let late = 0;
  const watchLoad = new Function(`${WATCH_LOAD}; return watchLoad;`)() as (
    doc: unknown,
    ms: number,
    isReady: () => boolean,
    onLate: () => void,
  ) => () => void;
  const stop = watchLoad(doc, 50, ready, () => {
    late += 1;
  });
  const set = (state: string) => {
    doc.visibilityState = state;
    for (const listener of [...listeners]) listener();
  };
  return { set, stop, late: () => late, listening: () => listeners.size };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the load limit is the dashboard's 20 seconds", () => {
  assert.equal(MOUNT_LOAD_TIMEOUT_MS, 20_000);
  assert.match(renderHostPage(), /LOAD_TIMEOUT_MS = 20000/);
});

test("time a page is hidden doesn't count toward the load limit, and it counts afresh when shown", async () => {
  const watched = hiddenPage();
  await pause(30);
  watched.set("hidden");
  await pause(70);
  assert.equal(watched.late(), 0, "hidden, so the limit didn't pass");
  watched.set("visible");
  await pause(30);
  assert.equal(watched.late(), 0, "the limit starts again");
  await pause(40);
  assert.equal(watched.late(), 1);
  assert.equal(watched.listening(), 0);
});

test("a page that answered isn't late, and stopping ends the watch", async () => {
  const answered = hiddenPage(() => true);
  await pause(70);
  assert.equal(answered.late(), 0);
  const stopped = hiddenPage();
  stopped.stop();
  assert.equal(stopped.listening(), 0);
  await pause(70);
  assert.equal(stopped.late(), 0);
});
