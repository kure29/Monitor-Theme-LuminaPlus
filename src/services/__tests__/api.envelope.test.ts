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
