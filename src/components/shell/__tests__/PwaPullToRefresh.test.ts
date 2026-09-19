import { describe, expect, it } from "vitest";
import { isIosStandalone } from "@/components/shell/PwaPullToRefresh";

describe("iOS PWA detection", () => {
  it("enables pull-to-refresh for installed iPhone and iPad apps", () => {
    expect(isIosStandalone("Mozilla/5.0 (iPhone)", "iPhone", 5, true, false)).toBe(true);
    expect(isIosStandalone("Mozilla/5.0 (Macintosh)", "MacIntel", 5, false, true)).toBe(true);
  });

  it("does not change normal Safari, Android PWA, or desktop behavior", () => {
    expect(isIosStandalone("Mozilla/5.0 (iPhone)", "iPhone", 5, false, false)).toBe(false);
    expect(isIosStandalone("Mozilla/5.0 (Linux; Android 15)", "Linux armv8l", 5, true, true)).toBe(false);
    expect(isIosStandalone("Mozilla/5.0 (Macintosh)", "MacIntel", 0, true, true)).toBe(false);
  });
});
