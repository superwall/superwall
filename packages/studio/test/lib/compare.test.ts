import { describe, expect, it } from "vitest";
import { compareAdded, compareSwapped, followDrafts } from "../../src/lib/compare";

describe("compareAdded", () => {
  it("adds last, and past the limit drops the one compared longest", () => {
    expect(compareAdded([], "a")).toEqual(["a"]);
    expect(compareAdded(["a"], "b")).toEqual(["a", "b"]);
    expect(compareAdded(["a", "b"], "c")).toEqual(["b", "c"]);
    expect(compareAdded(["a", "b"], "a")).toEqual(["b", "a"]);
    expect(compareAdded(["a", "b"], "c", 3)).toEqual(["a", "b", "c"]);
  });
});

describe("compareSwapped", () => {
  it("puts the new one in the old one's place, or just drops the old one when it is there", () => {
    expect(compareSwapped(["a", "b"], "a", "c")).toEqual(["c", "b"]);
    expect(compareSwapped(["a", "b"], "a", "b")).toEqual(["b"]);
  });
});

describe("followDrafts", () => {
  it("adds the drafts it has not seen, newest replacing oldest", () => {
    expect(followDrafts(["origin"], new Set(), ["d1", "d2", "d3"])).toEqual(["d2", "d3"]);
    expect(followDrafts(["d1"], new Set(["d1"]), ["d1", "d2"])).toEqual(["d1", "d2"]);
    expect(followDrafts([], new Set(["d1", "d2"]), ["d1", "d2"])).toEqual([]);
  });
});
