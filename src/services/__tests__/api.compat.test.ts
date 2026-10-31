import { afterEach, describe, expect, it, vi } from "vitest";
import { getLoadRecords, monitorNodeToInfo, normalizePingHistory } from "@/services/api";

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

  it("retains a backend-assigned probe before its first sample arrives", () => {
    const result = normalizePingHistory("9", 1, {
      probes: { "2": "Cloudflare", "3": "Backup" },
      ping: [{ task_id: 2, ts: 1_700_000_000, latency: 24 }],
    });

    expect(result.tasks).toEqual([
      expect.objectContaining({ id: 2, clients: ["9"] }),
      expect.objectContaining({ id: 3, name: "Backup", clients: ["9"] }),
    ]);
    expect(result.records).toHaveLength(1);
  });

  it("does not treat an old sample as a currently assigned task", () => {
    const result = normalizePingHistory("9", 1, {
      probes: { "2": "Google" },
      ping: [
        { task_id: 1, ts: 1_700_000_000, latency: 40 },
        { task_id: 2, ts: 1_700_000_060, latency: 50 },
      ],
    });
    expect(result.tasks.map((task) => task.id)).toEqual([2]);
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

describe("monitor 1.3–1.5 public fields", () => {
  it("reads the public remark, never the private one", () => {
    const info = monitorNodeToInfo({ id: 3, remark: "私有", public_remark: "CN2 GIA" });
    expect(info.public_remark).toBe("CN2 GIA");
    expect(monitorNodeToInfo({ id: 3, remark: "私有" }).public_remark).toBe("");
  });

  it("orders probes the way the panel lists them", () => {
    // hub 按后台延迟页的顺序逐个探测输出，不再按时间交错。
    const result = normalizePingHistory("9", 1, {
      probes: { "1": "A", "2": "B", "3": "C", "4": "D" },
      ping: [
        { task_id: 3, ts: 1_700_000_000, latency: 10 },
        { task_id: 3, ts: 1_700_000_060, latency: 11 },
        { task_id: 1, ts: 1_700_000_000, latency: 20 },
        { task_id: 2, ts: 1_700_000_000, latency: 30 },
      ],
    });
    expect(result.tasks.map((task) => task.id)).toEqual([3, 1, 2, 4]);
  });

  it("charts swap, connections and processes once the hub returns them", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      step: 300,
      metrics: [{ ts: 1_700_000_000, cpu: 5, swap_used: 1024, tcp: 40, udp: 3, procs: 120 }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const result = await getLoadRecords("11", 24);
    expect(result.intervalSeconds).toBe(300);
    expect(result.records[0]).toMatchObject({
      swap: 1024,
      connections: 40,
      connections_udp: 3,
      process: 120,
      history_capabilities: { swap: true, connections: true, process: true, load: false },
    });
  });
});
