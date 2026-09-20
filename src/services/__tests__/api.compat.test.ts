import { afterEach, describe, expect, it, vi } from "vitest";
import { getLoadRecords, normalizePingHistory } from "@/services/api";

afterEach(() => vi.unstubAllGlobals());

describe("monitor Ping history adapter", () => {
  it("preserves probe labels, inferred intervals and packet loss", () => {
    const result = normalizePingHistory("9", 4, {
      probes: { "2": "Cloudflare" },
      ping: [
        { task_id: 2, ts: 1_700_000_000, latency: 24, loss: 0 },
        { task_id: 2, ts: 1_700_000_060, latency: null, loss: 100 },
      ],
    });

    expect(result.tasks).toEqual([
      expect.objectContaining({ id: 2, name: "Cloudflare", clients: ["9"], interval: 60 }),
    ]);
    expect(result.records).toEqual([
      expect.objectContaining({ client: "9", value: 24, loss: 0 }),
      expect.objectContaining({ client: "9", value: -1, loss: 100 }),
    ]);
    expect(result.intervalSeconds).toBe(60);
  });

  it("surfaces the window loss instead of leaving it to per-bucket averages (regression)", () => {
    // monitor 的逐桶 loss 是桶内百分比(分母已经丢了),窗口丢包率只在顶层 loss 里;
    // 主题以前自己平均逐桶值,于是「180 次里丢 1 次」被算成 0%。
    const result = normalizePingHistory("9", 4, {
      probes: { 2: "Cloudflare" },
      loss: { 2: 0.56 },
      ping: [
        { task_id: 2, ts: 1_700_000_000, latency: 24, loss: 1 },
        { task_id: 2, ts: 1_700_000_060, latency: 25 },
      ],
    });

    expect(result.windowLoss).toEqual({ 2: 0.56 });
    expect(result.tasks[0]).toMatchObject({ id: 2, loss: 0.56 });
  });
});

describe("monitor resource history adapter", () => {
  it("marks fields omitted by monitor so charts do not draw fake zero values", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      metrics: [{ ts: 1_700_000_000, cpu: 12, mem_used: 512, disk_used: 2048, net_rx: 20, net_tx: 10 }],
    }), { status: 200 })));

    const result = await getLoadRecords("9", 4);
    expect(result.records[0]).toMatchObject({
      cpu: 12,
      history_capabilities: {
        swap: false,
        trafficTotals: false,
        connections: false,
        process: false,
        load: false,
      },
    });
  });
});
