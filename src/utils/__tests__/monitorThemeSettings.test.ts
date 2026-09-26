import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublic, loadThemeSettings } from "@/services/api";

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

describe("monitor theme settings", () => {
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
    expect(storage.getItem("monitor-theme-luminaplus:settings")).toBe(
      JSON.stringify({ showPingChart: false }),
    );
  });

  it("keeps the homepage available while refusing malformed settings as a save base", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(
      JSON.stringify(String(input) === "/api/me"
        ? { authed: true, site_name: "Monitor", public_page: true }
        : ["invalid"]),
      { status: 200 },
    )));

    await expect(getPublic()).resolves.toMatchObject({
      theme_settings: {},
      theme_settings_error: "主题配置接口返回的内容不是 JSON 对象",
    });
    await expect(loadThemeSettings()).rejects.toThrow("主题配置接口返回的内容不是 JSON 对象");
  });

  it("keeps site metadata when the theme config endpoint is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/me"
        ? new Response(JSON.stringify({ authed: false, site_name: "Fleet", public_page: true }))
        : new Response("unavailable", { status: 503 }),
    ));

    await expect(getPublic()).resolves.toMatchObject({
      sitename: "Fleet",
      private_site: false,
      theme_settings: {},
      theme_settings_error: "主题配置接口返回 HTTP 503",
    });
  });

  it("explains when the hub lacks the theme config endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/me"
        ? new Response(JSON.stringify({ authed: false, public_page: true }))
        : new Response("not found", { status: 404 }),
    ));

    await expect(getPublic()).resolves.toMatchObject({
      theme_settings_error: "monitor 未提供主题配置接口（HTTP 404），请升级 monitor",
    });
  });
});
