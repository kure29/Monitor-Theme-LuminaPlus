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

  it("uses the site default file as the base and lets this browser override it", async () => {
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("theme-settings.json")) {
          return new Response(
            JSON.stringify({ backgroundImage: "/site.webp", showPingChart: true }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ authed: false, site_name: "Monitor", public_page: true }),
          { status: 200 },
        );
      }),
    );

    // 本机保存过的键覆盖站点默认值,没保存过的键沿用站点默认值。
    await saveThemeSettings("LuminaPlus", { showPingChart: false });
    await expect(getPublic()).resolves.toMatchObject({
      theme_settings: { backgroundImage: "/site.webp", showPingChart: false },
    });
  });

  it("ignores a missing or non-JSON site default file", async () => {
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("theme-settings.json")
          // hub 对不存在的文件回落到 index.html:解析失败必须被忽略而不是报错。
          ? new Response("<!doctype html><html></html>", { status: 200 })
          : new Response(JSON.stringify({ authed: false, public_page: true }), { status: 200 }),
      ),
    );

    await expect(getPublic()).resolves.toMatchObject({ theme_settings: {} });
  });
});
