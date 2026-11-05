import assert from "node:assert/strict";
import { test } from "node:test";
import { renderHostPage } from "@/core/workspaces/dev/host-page";
import { BRIDGE_PROTOCOL } from "@/core/workspaces/wire";

test("the host page speaks the bridge the frame expects", () => {
  const page = renderHostPage();
  assert.ok(page.includes(BRIDGE_PROTOCOL));
  for (const message of ['"connect"', '"theme"', '"visibility"', '"resize"', '"ready"']) {
    assert.ok(page.includes(message), message);
  }
  assert.ok(page.includes("allow-scripts allow-same-origin allow-forms allow-popups"));
  new Function(page.slice(page.indexOf("<script>") + 8, page.lastIndexOf("</script>")));
});
