import { afterEach, describe, expect, it, vi } from "vitest";
import { getLoadRecords } from "@/services/api";

afterEach(() => vi.unstubAllGlobals());

describe("monitor request errors", () => {
  it("keeps the server status, route and response message", async () => {
    // 503 会被退避重试(见 api.history-throttle.test.ts),所以每次调用都要给一个全新的
    // Response:真实 fetch 也是这样,重复使用同一个对象会让 body 读到第二次时报错。
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(new Response("too many history queries", { status: 503 })),
      ),
    );

    await expect(getLoadRecords("3", 24)).rejects.toEqual(
      expect.objectContaining({
        name: "ApiRequestError",
        status: 503,
        path: expect.stringContaining("/api/nodes/3/metrics"),
        message: "too many history queries",
      }),
    );
  });
});
