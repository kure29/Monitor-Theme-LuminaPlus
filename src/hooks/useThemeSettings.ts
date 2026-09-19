import { useMemo } from "react";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { normalizeThemeSettings, type ResolvedThemeSettings } from "@/utils/themeSettings";

type RawThemeSettings = Parameters<typeof normalizeThemeSettings>[0];

let cachedRawThemeSettings: RawThemeSettings = undefined;
let cachedResolvedThemeSettings: ResolvedThemeSettings | null = null;

function getCachedResolvedThemeSettings(raw: RawThemeSettings): ResolvedThemeSettings {
  if (cachedResolvedThemeSettings && raw === cachedRawThemeSettings) {
    return cachedResolvedThemeSettings;
  }
  cachedRawThemeSettings = raw;
  cachedResolvedThemeSettings = normalizeThemeSettings(raw);
  return cachedResolvedThemeSettings;
}

type ThemeSettingsState = ResolvedThemeSettings & {
  /**
   * 服务端 config 到达后为 true。config 请求失败时它也会变 true，
   * 让应用回退到默认值，而不是一直空白。
   */
  isReady: boolean;
  isLoading: boolean;
  isError: boolean;
};

export function useThemeSettings(): ThemeSettingsState {
  const { data: config, isError, isLoading } = usePublicConfig();
  const hasConfig = config != null;
  const isReady = hasConfig || isError;
  return useMemo(
    () => ({
      ...getCachedResolvedThemeSettings(config?.theme_settings),
      isReady,
      isLoading: isLoading && !hasConfig,
      isError,
    }),
    [config?.theme_settings, hasConfig, isError, isLoading, isReady],
  );
}
