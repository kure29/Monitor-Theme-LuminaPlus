import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, getMe, getPublic, saveThemeSettings } from "@/services/api";

afterEach(() => vi.unstubAllGlobals());

describe("monitor site metadata adapter", () => {
  it("derives authentication and public configuration from /api/me", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => Promise.resolve(
      new Response(JSON.stringify(input === "/api/me" ? {
        authed: true,
        github: true,
        site_name: "Fleet",
        public_page: true,
      } : {
        showGroupTabs: false,
      }), { status: 200 }),
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getMe()).resolves.toMatchObject({ logged_in: true });
    await expect(getPublic()).resolves.toMatchObject({
      sitename: "Fleet",
      theme: "LuminaPlus",
      oauth_enable: true,
      private_site: false,
      theme_settings: { showGroupTabs: false },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/themes/LuminaPlus/config",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("shows the private-site gate to anonymous visitors without requesting protected theme settings", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      new Response(
        String(input) === "/api/me"
          ? JSON.stringify({ authed: false, site_name: "Fleet", public_page: false })
          : "需要登录后查看",
        { status: String(input) === "/api/me" ? 200 : 401 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPublic()).resolves.toMatchObject({
      sitename: "Fleet",
      private_site: true,
      theme_settings: {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/me");
  });

  it("still loads saved theme settings for a signed-in private-site visitor", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(
      JSON.stringify(String(input) === "/api/me"
        ? { authed: true, site_name: "Fleet", public_page: false }
        : { showGroupTabs: false }),
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPublic()).resolves.toMatchObject({
      private_site: true,
      theme_settings: { showGroupTabs: false },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not bypass access checks when site metadata itself is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    await expect(getPublic()).rejects.toMatchObject({ status: 503, path: "/api/me" });
  });

  it("saves server settings with PUT and reports errors", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("theme is not installed", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveThemeSettings("LuminaPlus", { showGroupTabs: false })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/themes/LuminaPlus/config",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        body: JSON.stringify({ showGroupTabs: false }),
      }),
    );
    await expect(saveThemeSettings("LuminaPlus", {})).rejects.toMatchObject({
      status: 400,
      message: "theme is not installed",
    } satisfies Partial<ApiRequestError>);
  });
});
