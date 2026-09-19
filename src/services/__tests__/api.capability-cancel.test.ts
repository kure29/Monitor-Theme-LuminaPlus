import { afterEach, describe, expect, it, vi } from "vitest";
import { getLoadRecords } from "@/services/api";

afterEach(() => vi.unstubAllGlobals());

describe("monitor request cancellation", () => {
  it("forwards the caller AbortSignal to the history request", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_path: string, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true);
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    vi.stubGlobal("fetch", fetchMock);

    controller.abort();
    await expect(getLoadRecords("1", 6, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
