import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdminPingTasks } from "@/services/api";

afterEach(() => vi.unstubAllGlobals());

describe("monitor probe task adapter", () => {
  it("maps numeric node ids to theme client ids", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tasks: [{ id: 4, name: "Origin", target: "example.com:443", interval: 15, nodes: [2, 8] }],
    }), { status: 200 })));

    await expect(getAdminPingTasks()).resolves.toEqual([
      expect.objectContaining({ id: 4, interval: 15, clients: ["2", "8"] }),
    ]);
  });
});
