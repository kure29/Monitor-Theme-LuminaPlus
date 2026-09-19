import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublic, saveThemeSettings } from "@/services/api";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
  clear: () => values.clear(),
  key: (index: number) => [...values.keys()][index] ?? null,
  get length() { return values.size; },
};

afterEach(() => {
  values.clear();
  vi.unstubAllGlobals();
});

describe("monitor browser-local theme settings", () => {
  it("round-trips theme preferences without a server settings endpoint", async () => {
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      authed: false,
      site_name: "Monitor",
      public_page: true,
    }), { status: 200 })));

    await saveThemeSettings("LuminaPlus", { showPingChart: false });
    await expect(getPublic()).resolves.toMatchObject({
      theme_settings: { showPingChart: false },
    });
  });
});
