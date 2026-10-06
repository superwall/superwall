import { describe, expect, it } from "vitest";
import {
  latestVersion,
  liveVersion,
  promotionBlocker,
  promotionDirection,
  promotionHint,
} from "../../src/lib/promotion";
import type { StudioVersion } from "../../src/lib/surfaces";

const versions: StudioVersion[] = [
  { version: 13, url: "https://cdn.test/13.html", live: false },
  { version: 12, url: "https://cdn.test/12.html", live: true },
  { version: 11, url: "https://cdn.test/11.html", live: false },
];

describe("which version a promote reaches for", () => {
  it("reads the live and the newest pushed version off the list, in any order", () => {
    expect(liveVersion(versions)).toBe(12);
    expect(latestVersion(versions)).toBe(13);
    expect(latestVersion([...versions].reverse())).toBe(13);
    expect(liveVersion([])).toBeUndefined();
    expect(latestVersion([])).toBeUndefined();
  });
});

describe("promote or roll back", () => {
  it("is a rollback only when the target is older than what is live", () => {
    expect(promotionDirection(13, 12)).toBe("promote");
    expect(promotionDirection(11, 12)).toBe("rollback");
    expect(promotionDirection(12, 12)).toBe("promote");
  });

  it("is a promote when nothing is live yet, or nothing is pushed", () => {
    expect(promotionDirection(1, undefined)).toBe("promote");
    expect(promotionDirection(undefined, undefined)).toBe("promote");
    expect(promotionDirection(undefined, 3)).toBe("promote");
  });
});

describe("what the menu says about it", () => {
  it("names the version it would make live and the one it replaces", () => {
    expect(promotionHint({ target: 13, live: 12 })).toBe("Make v13 live, replacing v12");
    expect(promotionHint({ target: 11, live: 12 })).toBe("Make v11 live again, replacing v12");
    expect(promotionHint({ target: 1, live: undefined })).toBe("Make v1 live");
    expect(promotionHint({ target: 12, live: 12 })).toBe("v12 is live today");
    expect(promotionHint({ target: undefined, live: undefined })).toBe("Make the latest push live");
  });

  it("blocks a promote that would change nothing, and one with nothing to promote", () => {
    expect(promotionBlocker({ target: 12, live: 12, versions })).toBe("v12 is already live");
    expect(promotionBlocker({ target: 13, live: 12, versions })).toBeUndefined();
    expect(promotionBlocker({ target: undefined, live: undefined, versions: [] })).toBe(
      "Nothing has been pushed yet",
    );
  });
});
