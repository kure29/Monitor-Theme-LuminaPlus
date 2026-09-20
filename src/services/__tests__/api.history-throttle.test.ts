import { afterEach, describe, expect, it, vi } from "vitest";
import { getPingRecords, getPingOverview } from "@/services/api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const payload = JSON.stringify({
  probes: { 7: "Cloudflare" },
  ping: [{ task_id: 7, ts: 1_700_000_000, latency: 24, loss: 0 }],
});

describe("monitor history requests", () => {
  it("shares one response between concurrent calls for the same node and window", async () => {
    const fetchMock = vi.fn(async () => new Response(payload, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    // 三网模式会对同一节点按任务各查一次;合并后只应发出一次请求,响应再分别解析。
    const [first, second] = await Promise.all([
      getPingRecords("7", 1),
      getPingRecords("7", 1),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.records).toHaveLength(1);
    expect(second.records).toHaveLength(1);
  });

  it("retries the hub's 'too many history queries' refusal before failing", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("too many history queries in flight, try again", { status: 503 }),
      )
      .mockResolvedValueOnce(new Response(payload, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const request = getPingRecords("9", 1);
    // 第一次 503 后先退避再重试,而不是直接把整块图表标成失败。
    await vi.advanceTimersByTimeAsync(500);
    await expect(request).resolves.toMatchObject({ count: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up on a refusal that repeats, and reuses the shared response for every task of one node", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("series=ping")) return new Response(payload, { status: 200 });
      return new Response(JSON.stringify({ nodes: [{ id: 7, name: "Tokyo", public: true }] }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPingOverview(1, undefined, { entityIds: ["7"] });
    const pingRequests = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("series=ping"),
    );
    expect(pingRequests).toHaveLength(1);
    expect(result.tasks.map((task) => task.id)).toEqual([7]);
  });
});
