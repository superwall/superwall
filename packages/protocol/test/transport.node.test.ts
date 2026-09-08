import { describe, expect, it } from "vitest";
import { pendingHostMessages } from "../src/transport/webkit";

describe("pendingHostMessages outside a browser", () => {
  it("has nowhere to queue and reports an empty queue", () => {
    expect(pendingHostMessages()).toEqual([]);
  });
});
