import { afterEach, describe, expect, it, vi } from "vitest";
import { getLoadRecords } from "@/services/api";

afterEach(() => vi.unstubAllGlobals());

describe("monitor request errors", () => {
  it("keeps the server status, route and response message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("too many history queries", {
      status: 503,
    })));

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
