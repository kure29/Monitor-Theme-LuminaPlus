import { describe, expect, it, vi } from "vitest";
import {
  buildBackendPingOverviewMap,
  buildPingBuckets,
  buildPingOverviewItems,
  selectPersistablePingOverview,
} from "@/hooks/usePingOverview";

const MINUTE_MS = 60_000;
const NOW = Date.UTC(2026, 6, 17, 11, 2);
const WINDOW_START = NOW - 60 * MINUTE_MS;

function aggregateSamples(intervalMinutes: number) {
  const alignedStart = Date.UTC(2026, 6, 17, 10, 0);
  const count = Math.ceil((NOW - alignedStart) / (intervalMinutes * MINUTE_MS));
  return Array.from({ length: count }, (_, index) => ({
    time: alignedStart + index * intervalMinutes * MINUTE_MS,
    value: 40 + index,
    count: intervalMinutes,
    loss: 0,
  }));
}

describe("homepage ping metric interval adaptation", () => {
  it("propagates the metric API interval into the homepage item", () => {
    const items = buildPingOverviewItems(
      7,
      [
        {
          task_id: 7,
          time: "2026-07-17T10:00:00Z",
          value: 42,
          client: "node-a",
          count: 5,
          loss: 0,
        },
      ],
      [],
      300,
    );

    expect(items.get("node-a")?.metricIntervalMs).toBe(5 * MINUTE_MS);
  });

  it("prefers the hub's window loss over averaging per-bucket percentages (regression)", () => {
    const records = [
      { task_id: 7, time: "2026-07-17T10:00:00Z", value: 42, client: "node-a", count: 1, loss: 1 },
      { task_id: 7, time: "2026-07-17T10:01:00Z", value: 43, client: "node-a", count: 1, loss: 0 },
    ];

    // 逐桶 1% 会被 round 成"这一桶没有丢包",窗口值必须取自 monitor 的 loss。
    const withoutWindow = buildPingOverviewItems(7, records, [], 60);
    expect(withoutWindow.get("node-a")?.loss).toBe(0);

    const withWindow = buildPingOverviewItems(
      7,
      records,
      [],
      60,
      new Map([["node-a", 0.56]]),
    );
    expect(withWindow.get("node-a")?.loss).toBe(0.56);
  });

  it("projects 1.2.7 five-minute aggregates across twenty-four continuous buckets", () => {
    const buckets = buildPingBuckets(
      {
        metricIntervalMs: 5 * MINUTE_MS,
        samples: aggregateSamples(5),
      },
      24,
      NOW,
    );

    expect(buckets).toHaveLength(24);
    expect(buckets.every((bucket) => bucket.total > 0 && bucket.value != null)).toBe(true);
    expect(buckets[0]?.startAt).toBe(WINDOW_START);
    expect(buckets[23]?.endAt).toBe(NOW);
  });

  it("removes the compact-card two-on one-off artifact without hiding a real gap", () => {
    const samples = aggregateSamples(5).filter(
      (sample) => sample.time !== Date.UTC(2026, 6, 17, 10, 30),
    );
    const buckets = buildPingBuckets(
      { metricIntervalMs: 5 * MINUTE_MS, samples },
      18,
      NOW,
    );

    expect(buckets).toHaveLength(18);
    expect(buckets.filter((bucket) => bucket.total === 0)).toHaveLength(2);
  });

  it("keeps 1.2.6 two-minute aggregates at the existing 24-bucket density", () => {
    const buckets = buildPingBuckets(
      {
        metricIntervalMs: 2 * MINUTE_MS,
        samples: Array.from({ length: 31 }, (_, index) => ({
          time: WINDOW_START + index * 2 * MINUTE_MS,
          value: 30,
          count: 2,
          loss: 0,
        })),
      },
      24,
      NOW,
    );

    expect(buckets).toHaveLength(24);
    expect(buckets.every((bucket) => bucket.total > 0)).toBe(true);
  });

  it("preserves the legacy fixed bucket count when interval metadata is absent", () => {
    const buckets = buildPingBuckets(
      {
        samples: [{ time: NOW - MINUTE_MS, value: 25 }],
      },
      18,
      NOW,
    );

    expect(buckets).toHaveLength(18);
    expect(buckets.filter((bucket) => bucket.total > 0)).toHaveLength(1);
  });
});

describe("homepage ping polling selection", () => {
  it("uses backend probes for all card lines and drops a revoked task", async () => {
    const loadOverview = vi.fn(async () => ({
      records: [
        { task_id: 1, time: NOW, value: 45, client: "node-a", count: 1, loss: 0 },
        { task_id: 2, time: NOW, value: 72, client: "node-a", count: 1, loss: 0 },
        { task_id: 2, time: NOW, value: 81, client: "node-b", count: 1, loss: 0 },
      ],
      tasks: [
        { id: 1, name: "Cloudflare", clients: ["node-a"], interval: 60, loss: 0, type: "tcp", target: "", weight: 1 },
        { id: 2, name: "Google", clients: ["node-a", "node-b"], interval: 60, loss: 0, type: "tcp", target: "", weight: 2 },
      ],
      intervalSeconds: 60,
      clientWindowLoss: { "node-a": { 2: 12 } },
    }));
    const initial = await buildBackendPingOverviewMap(
      1, ["node-b", "node-a"], { "2": ["node-a"] }, undefined, loadOverview as never,
    );

    expect(loadOverview).toHaveBeenCalledWith(1, undefined, expect.objectContaining({
      entityIds: ["node-a", "node-b"],
    }));
    expect(initial.multiLines.get("node-a")?.map((line) => line.taskId)).toEqual([1, 2]);
    expect(initial.multiLines.get("node-b")?.map((line) => line.taskId)).toEqual([2]);
    expect(initial.singleItems.get("node-a")?.lastValue).toBe(72);
    expect(initial.multiLines.get("node-a")?.[1]?.loss).toBe(12);

    loadOverview.mockImplementationOnce(async () => ({
      records: [{ task_id: 2, time: NOW, value: 80, client: "node-a", count: 1, loss: 0 }],
      tasks: [{ id: 2, name: "Google", clients: ["node-a"], interval: 60, loss: 0, type: "tcp", target: "", weight: 2 }],
      intervalSeconds: 60,
      clientWindowLoss: { "node-a": { 2: 0 } },
    }));
    const afterRemoval = await buildBackendPingOverviewMap(
      1, ["node-a"], { "1": ["node-a"] }, undefined, loadOverview as never,
    );
    expect(afterRemoval.multiLines.get("node-a")?.map((line) => line.taskId)).toEqual([2]);
    expect(afterRemoval.singleItems.get("node-a")?.lastValue).toBe(80);

    loadOverview.mockImplementationOnce(async () => ({
      records: [], tasks: [], intervalSeconds: 60, clientWindowLoss: { "node-a": { 2: 0 } },
    }));
    const unassigned = await buildBackendPingOverviewMap(
      1, ["node-a"], { "1": ["node-a"] }, undefined, loadOverview as never,
    );
    expect(unassigned.multiLines.get("node-a")).toEqual([]);
    expect(unassigned.singleItems.get("node-a")).toMatchObject({
      isAssigned: false, loadState: "ready",
    });
  });

  it("updates healthy nodes while preserving and marking a failed node's last result", async () => {
    const initial = await buildBackendPingOverviewMap(
      1, ["node-a", "node-b"], {}, undefined,
      (async () => ({
        records: [
          { task_id: 1, time: NOW, value: 45, client: "node-a", count: 1, loss: 0 },
          { task_id: 2, time: NOW, value: 70, client: "node-b", count: 1, loss: 0 },
        ],
        tasks: [
          { id: 1, name: "A", clients: ["node-a"], interval: 60, loss: 0, type: "tcp", target: "", weight: 1 },
          { id: 2, name: "B", clients: ["node-b"], interval: 60, loss: 0, type: "tcp", target: "", weight: 2 },
        ],
        failedEntityIds: [],
        successfulEntityIds: ["node-a", "node-b"],
      })) as never,
    );
    const partial = await buildBackendPingOverviewMap(
      1, ["node-a", "node-b"], {}, undefined,
      (async () => ({
        records: [{ task_id: 2, time: NOW + MINUTE_MS, value: 82, client: "node-b", count: 1, loss: 0 }],
        tasks: [{ id: 2, name: "B", clients: ["node-b"], interval: 60, loss: 0, type: "tcp", target: "", weight: 2 }],
        failedEntityIds: ["node-a"],
        successfulEntityIds: ["node-b"],
      })) as never,
      initial,
    );

    expect(partial.successfulRequest).toBe(true);
    expect(partial.failedUuids).toEqual(["node-a"]);
    expect(partial.singleItems.get("node-a")).toMatchObject({ lastValue: 45, loadState: "error", isAssigned: true });
    expect(partial.multiLines.get("node-a")?.[0]).toMatchObject({ taskId: 1, lastValue: 45, loadState: "error" });
    expect(partial.singleItems.get("node-b")).toMatchObject({ lastValue: 82, loadState: "ready" });
    expect(selectPersistablePingOverview(partial)).toBeNull();
  });

  it("marks all failed requests as errors without treating them as unassigned", async () => {
    const failed = await buildBackendPingOverviewMap(
      1, ["node-a"], {}, undefined,
      (async () => ({ records: [], tasks: [], failedEntityIds: ["node-a"], successfulEntityIds: [] })) as never,
    );
    expect(failed.successfulRequest).toBe(false);
    expect(failed.singleItems.get("node-a")).toMatchObject({ loadState: "error", lastValue: null });
    expect(selectPersistablePingOverview(failed)).toBeNull();
  });

  it("does not reuse a failed node's prior result after its preferred task changes", async () => {
    const previous = await buildBackendPingOverviewMap(
      1, ["node-a"], { "1": ["node-a"] }, undefined,
      (async () => ({
        records: [{ task_id: 1, time: NOW, value: 45, client: "node-a", count: 1, loss: 0 }],
        tasks: [{ id: 1, name: "A", clients: ["node-a"], interval: 60, loss: 0, type: "tcp", target: "", weight: 1 }],
      })) as never,
    );
    const failed = await buildBackendPingOverviewMap(
      1, ["node-a"], { "2": ["node-a"] }, undefined,
      (async () => ({ records: [], tasks: [], failedEntityIds: ["node-a"] })) as never,
      previous,
    );
    expect(failed.singleItems.get("node-a")).toMatchObject({ lastValue: null, loadState: "error" });
    expect(failed.multiLines.get("node-a")).toEqual([]);
  });

  it("persists a successful empty assignment so revoked tasks cannot reappear from cache", async () => {
    const empty = await buildBackendPingOverviewMap(
      1, ["node-a"], {}, undefined,
      (async () => ({ records: [], tasks: [], failedEntityIds: [], successfulEntityIds: ["node-a"] })) as never,
    );
    expect(empty.successfulRequest).toBe(true);
    expect(selectPersistablePingOverview(empty)).toEqual({
      singleItems: [["node-a", expect.objectContaining({ isAssigned: false, loadState: "ready" })]],
      multiLines: [],
    });
  });
});
