import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  push(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  drop() {
    this.closed = true;
    this.onclose?.();
  }
}

const snapshot = {
  nodes: [{ id: 7, online: true, metrics: { cpu: 12, net_rx: 1, net_tx: 2 } }],
};

async function loadApi() {
  vi.resetModules();
  return import("@/services/api");
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("window", {
    location: { protocol: "http:", host: "hub.test" },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("live snapshot socket", () => {
  it("opens one socket for all subscribers and closes it after the last one leaves", async () => {
    const { subscribeLiveSnapshots } = await loadApi();
    const releaseFirst = subscribeLiveSnapshots(() => {});
    const releaseSecond = subscribeLiveSnapshots(() => {});
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]?.url).toBe("ws://hub.test/api/ws");

    releaseFirst();
    expect(FakeWebSocket.instances[0]?.closed).toBe(false);
    releaseSecond();
    expect(FakeWebSocket.instances[0]?.closed).toBe(true);

    vi.advanceTimersByTime(120_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("notifies subscribers on push and keeps the timestamp stable for repeated cache reads", async () => {
    const { getNodesLatestStatus, subscribeLiveSnapshots } = await loadApi();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const listener = vi.fn();
    subscribeLiveSnapshots(listener);

    FakeWebSocket.instances[0]?.push(snapshot);
    expect(listener).toHaveBeenCalledTimes(1);

    const first = await getNodesLatestStatus(["7"]);
    vi.advanceTimersByTime(2_000);
    const second = await getNodesLatestStatus(["7"]);
    expect(fetchMock).not.toHaveBeenCalled();
    // 同一份快照被轮询读两次,时间戳不能变,否则 store 会当成新样本。
    expect(second["7"]).toEqual(first["7"]);

    FakeWebSocket.instances[0]?.push(snapshot);
    const third = await getNodesLatestStatus(["7"]);
    expect((third["7"] as { updated_at: number }).updated_at).toBeGreaterThan(
      (first["7"] as { updated_at: number }).updated_at,
    );
  });

  it("ignores frames that are not node snapshots", async () => {
    const { subscribeLiveSnapshots } = await loadApi();
    const listener = vi.fn();
    subscribeLiveSnapshots(listener);
    FakeWebSocket.instances[0]?.push({ hello: "world" });
    FakeWebSocket.instances[0]?.onmessage?.({ data: "not json" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("backs off reconnects while the socket keeps failing and resets after a snapshot", async () => {
    const { subscribeLiveSnapshots } = await loadApi();
    subscribeLiveSnapshots(() => {});

    FakeWebSocket.instances[0]?.drop();
    vi.advanceTimersByTime(4_999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.instances[1]?.drop();
    vi.advanceTimersByTime(9_999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    FakeWebSocket.instances[2]?.push(snapshot);
    FakeWebSocket.instances[2]?.drop();
    vi.advanceTimersByTime(5_000);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });
});
