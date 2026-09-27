import { describe, expect, it } from "vitest";
import { buildHomepagePingDisplayLines, shouldRenderHomepagePingBars } from "@/hooks/useNodeCardModel";
import { buildFakePingItem } from "@/utils/fakePing";
import type { HomepagePingLine } from "@/types/models";

const NOW = Date.UTC(2026, 8, 27, 10, 0);
const fakePing = buildFakePingItem("node-a", NOW / 60_000);

describe("homepage ping bar visibility", () => {
  it("keeps simulated ping bars visible without a real task binding", () => {
    expect(shouldRenderHomepagePingBars(false, true)).toBe(true);
    expect(shouldRenderHomepagePingBars(false, false)).toBe(false);
    expect(shouldRenderHomepagePingBars(true, false)).toBe(true);
  });
});

describe("multi-line simulated ping", () => {
  it("shows one labeled simulated line when an online node has no assigned tasks", () => {
    const lines = buildHomepagePingDisplayLines("node-a", [], fakePing, [], {}, 24, NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      taskId: 0,
      taskName: "延迟",
      simulated: true,
      loss: 0,
    });
    expect(lines[0]?.buckets).toHaveLength(24);
    expect(lines[0]?.lastValue).toBeGreaterThanOrEqual(1);
  });

  it("keeps real assignments real and does not invent a line when a filter hides them", () => {
    const realLine: HomepagePingLine = {
      taskId: 7,
      taskName: "Cloudflare",
      client: "node-a",
      isAssigned: true,
      loadState: "ready",
      lastValue: 85,
      samples: [{ time: NOW, value: 85 }],
      max: 85,
      loss: 0,
    };
    const shown = buildHomepagePingDisplayLines("node-a", [realLine], fakePing, [], {}, 24, NOW);
    expect(shown).toMatchObject([{ taskId: 7, lastValue: 85 }]);
    expect(shown[0]?.simulated).not.toBe(true);

    const hidden = buildHomepagePingDisplayLines(
      "node-a", [realLine], fakePing, [], { "node-a": [8] }, 24, NOW,
    );
    expect(hidden).toEqual([]);
  });

  it("does not simulate before assignment data is ready or after a request error", () => {
    for (const loadState of ["pending", "error"] as const) {
      const unresolved = { ...fakePing, simulated: false, isAssigned: false, loadState };
      expect(buildHomepagePingDisplayLines("node-a", [], unresolved, [], {}, 24, NOW)).toEqual([]);
    }
  });
});
