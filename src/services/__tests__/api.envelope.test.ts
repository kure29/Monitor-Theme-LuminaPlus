import { afterEach, describe, expect, it, vi } from "vitest";
import { getMe, getPublic } from "@/services/api";

afterEach(() => vi.unstubAllGlobals());

describe("monitor site metadata adapter", () => {
  it("derives authentication and public configuration from /api/me", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      authed: true,
      github: true,
      site_name: "Fleet",
      public_page: true,
    }), { status: 200 }))));

    await expect(getMe()).resolves.toMatchObject({ logged_in: true });
    await expect(getPublic()).resolves.toMatchObject({
      sitename: "Fleet",
      theme: "LuminaPlus",
      oauth_enable: true,
      private_site: false,
    });
  });
});
