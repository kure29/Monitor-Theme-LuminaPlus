import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearLegacyThemeSettings,
  getPublic,
  readLegacyThemeSettings,
} from "@/services/api";

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

describe("monitor theme settings migration", () => {
  it("uses hub configuration without letting old browser settings override it", async () => {
    storage.setItem("monitor-theme-luminaplus:settings", JSON.stringify({ showPingChart: false }));
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(
      JSON.stringify(String(input) === "/api/me"
        ? { authed: false, site_name: "Monitor", public_page: true }
        : { showPingChart: true, backgroundImage: "/server.webp" }),
      { status: 200 },
    )));

    await expect(getPublic()).resolves.toMatchObject({
      theme_settings: { showPingChart: true, backgroundImage: "/server.webp" },
    });
    expect(readLegacyThemeSettings()).toEqual({ showPingChart: false });
    clearLegacyThemeSettings();
    expect(readLegacyThemeSettings()).toEqual({});
  });

  it("refuses malformed server configuration instead of treating it as an empty save base", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(
      JSON.stringify(String(input) === "/api/me"
        ? { authed: true, site_name: "Monitor", public_page: true }
        : ["invalid"]),
      { status: 200 },
    )));

    await expect(getPublic()).rejects.toThrow("主题配置接口返回的内容不是 JSON 对象");
  });
});
