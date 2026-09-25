import { afterEach, describe, expect, it, vi } from "vitest";
import { getPingRecords, getPingOverview } from "@/services/api";
import { buildBackendPingOverviewMap } from "@/hooks/usePingOverview";

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

  it("lets one caller cancel without aborting another caller's shared request", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        resolveFetch = resolve;
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }));
    vi.stubGlobal("fetch", fetchMock);
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = getPingRecords("17", 1, { signal: firstController.signal });
    const second = getPingRecords("17", 1, { signal: secondController.signal });

    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(false);
    resolveFetch(new Response(payload, { status: 200 }));
    await expect(second).resolves.toMatchObject({ count: 1 });
  });

  it("aborts the shared network request after its last caller cancels", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }));
    vi.stubGlobal("fetch", fetchMock);
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = getPingRecords("18", 1, { signal: firstController.signal });
    const second = getPingRecords("18", 1, { signal: secondController.signal });
    firstController.abort();
    secondController.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect((fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(true);
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

  it("reports failed nodes separately while retaining successful nodes' assignments", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      new Response(String(input).includes("/api/nodes/8/") ? "unavailable" : payload, {
        status: String(input).includes("/api/nodes/8/") ? 500 : 200,
      }),
    ));

    const result = await getPingOverview(1, 7, { entityIds: ["7", "8"] });
    expect(result.failedEntityIds).toEqual(["8"]);
    expect(result.successfulEntityIds).toEqual(["7"]);
    expect(result.tasks.map((task) => task.clients)).toEqual([["7"]]);
  });

  it("keeps an assigned task with no history samples in the homepage overview", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      probes: { 7: "Cloudflare" },
      ping: [],
    }), { status: 200 })));

    const result = await getPingOverview(1, 7, { entityIds: ["7"] });
    expect(result.taskAssignmentsKnown).toBe(true);
    expect(result.tasks).toEqual([
      expect.objectContaining({ id: 7, clients: ["7"] }),
    ]);
    expect(result.records).toEqual([]);
  });

  it("shows all backend-assigned lines for each node", async () => {
    const ts = Math.floor(Date.now() / 1000) - 60;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const isSecondNode = String(input).includes("/api/nodes/2/");
      return new Response(JSON.stringify(isSecondNode
        ? {
            probes: { 1: "Line A", 2: "Line B", 4: "Line C", 6: "Line D", 7: "Line E" },
            ping: [
              { task_id: 1, ts, latency: 212 },
              { task_id: 2, ts, latency: 289 },
              { task_id: 4, ts, latency: 263 },
              { task_id: 6, ts, latency: 310 },
              { task_id: 7, ts, latency: 345 },
            ],
          }
        : { probes: { 3: "Other A", 5: "Other B" }, ping: [] },
      ), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await buildBackendPingOverviewMap(
      1,
      ["1", "2"],
      {},
      undefined,
      getPingOverview,
    );

    expect(result.multiLines.get("1")?.map((line) => line.taskId)).toEqual([3, 5]);
    expect(result.multiLines.get("2")?.map((line) => line.taskId)).toEqual([1, 2, 4, 6, 7]);
    expect(result.multiLines.get("2")?.map((line) => line.lastValue)).toEqual([
      212, 289, 263, 310, 345,
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
