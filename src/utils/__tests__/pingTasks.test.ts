import { describe, expect, it } from "vitest";
import {
  createHomepageMultiPingTaskOverride,
  normalizeHomepageMultiPingNodeTaskIds,
  normalizeHomepageMultiPingTaskIds,
  orderHomepagePingTaskIds,
  resolveVisibleHomepagePingTaskIds,
  invertHomepagePingTaskBindings,
  normalizeHomepagePingTaskBindings,
} from "@/utils/pingTasks";

describe("homepage ping task bindings", () => {
  it("accepts only positive decimal safe integers", () => {
    expect(
      normalizeHomepagePingTaskBindings({
        "1e3": ["exponent"],
        "1.5": ["fraction"],
        "0x10": ["hex"],
        "9007199254740992": ["unsafe"],
        "42": ["valid"],
      }),
    ).toEqual({ "42": ["valid"] });
  });

  it("merges IDs that normalize to the same decimal integer", () => {
    expect(
      normalizeHomepagePingTaskBindings({
        "01": ["node-a", "node-b"],
        "1": ["node-b", "node-c"],
      }),
    ).toEqual({ "1": ["node-b", "node-c", "node-a"] });
  });

  it("inverts normalized bindings and gives the lowest task ID precedence", () => {
    expect(
      invertHomepagePingTaskBindings({
        "02": ["node-a"],
        "1": ["node-a", "node-b"],
      }),
    ).toEqual(
      new Map([
        ["node-a", 1],
        ["node-b", 1],
      ]),
    );
  });

  it("reuses the inverted binding index for a stable bindings object", () => {
    const bindings = { "8": ["node-a"], "9": ["node-b"] };
    expect(invertHomepagePingTaskBindings(bindings)).toBe(
      invertHomepagePingTaskBindings(bindings),
    );
  });

  it("preserves any number of unique global tasks in display order", () => {
    expect(normalizeHomepageMultiPingTaskIds(["3", 1, 3, 2, 4])).toEqual([3, 1, 2, 4]);
  });

  it("keeps nonempty per-node overrides of different lengths", () => {
    expect(
      normalizeHomepageMultiPingNodeTaskIds({
        " node-a ": [3, 1, 2],
        "node-b": [1, 1, 2],
        "node-c": ["4", "5", "6", "7"],
        "": [1, 2, 3],
      }),
    ).toEqual({
      "node-a": [3, 1, 2],
      "node-b": [1, 2],
      "node-c": [4, 5, 6, 7],
    });
  });

  it("initializes an override once without replacing an existing selection", () => {
    expect(
      createHomepageMultiPingTaskOverride(undefined, [1, 2, 3], [2, 3, 4, 5]),
    ).toEqual([2, 3, 4, 5]);
    expect(
      createHomepageMultiPingTaskOverride([4, 5, 6], [1, 2, 3], [1, 2, 3, 4, 5, 6]),
    ).toBeNull();
    expect(createHomepageMultiPingTaskOverride(undefined, [1, 2, 3], [1, 2])).toEqual([1, 2]);
    expect(createHomepageMultiPingTaskOverride(undefined, [1, 2, 3], [7])).toEqual([7]);
    expect(createHomepageMultiPingTaskOverride(undefined, [1, 2, 3], [])).toBeNull();
  });

  it("shows every backend task by default and applies optional order or per-node hiding", () => {
    expect(orderHomepagePingTaskIds([1, 2, 3, 4], [3, 1])).toEqual([3, 1, 2, 4]);
    expect(resolveVisibleHomepagePingTaskIds("node-a", [1, 2, 3, 4], [3, 1], {}))
      .toEqual([3, 1, 2, 4]);
    expect(resolveVisibleHomepagePingTaskIds("node-a", [1, 2, 3, 4], [3, 1], {
      "node-a": [4, 2, 99],
    })).toEqual([4, 2]);
  });

});
