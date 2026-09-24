import { describe, expect, it } from "vitest";
import {
  assignHomepagePingClients,
  getUnassignedHomepageMultiPingClients,
  removeHomepagePingClient,
  syncHomepagePingBindings,
} from "@/utils/pingBindings";

describe("homepage ping binding editor", () => {
  it("moves only the selected search results from their previous homepage task", () => {
    const previous = { "1": ["node-a", "node-b"], "2": ["node-c"] };
    const selected = assignHomepagePingClients(previous, 2, ["node-a"]);

    expect(selected).toEqual({ "1": ["node-b"], "2": ["node-a", "node-c"] });
    expect(previous).toEqual({ "1": ["node-a", "node-b"], "2": ["node-c"] });
    expect(removeHomepagePingClient(selected, 2, "node-a")).toEqual({
      "1": ["node-b"],
      "2": ["node-c"],
    });
  });

  it("uses real backend assignments, preserving valid choices and removing stale ones", () => {
    const result = syncHomepagePingBindings(
      { "8": ["node-a", "node-b"], "9": ["node-c"], "20": ["deleted-node"] },
      [
        { id: 3, clients: ["node-a", "node-b", "node-c"] },
        { id: 8, clients: ["node-a", "node-d"] },
        { id: 9, clients: ["node-b", "node-c"] },
      ],
      ["node-a", "node-b", "node-c", "node-d", "unassigned-node"],
    );

    expect(result).toEqual({
      "8": ["node-a", "node-d"],
      "9": ["node-c"],
    });
  });

  it("flags nodes whose selected global tasks have not been assigned in monitor", () => {
    expect(getUnassignedHomepageMultiPingClients(
      [
        { id: 1, clients: ["node-b"] },
        { id: 2, clients: ["node-b"] },
        { id: 3, clients: ["node-a"] },
        { id: 4, clients: ["node-b"] },
        { id: 5, clients: ["node-a"] },
      ],
      ["node-a", "node-b"],
      [1, 2, 4],
      {},
    )).toEqual(["node-a"]);
  });
});
