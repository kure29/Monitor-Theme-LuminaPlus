import type { Appearance } from "@/utils/themeSettings";

export type ResolvedAppearance = Exclude<Appearance, "system">;

export const DEFAULT_BACKGROUND_ALIGNMENT = "cover,center";
export const DEFAULT_SURFACE_OPACITY = 100;
export const DEFAULT_BACKGROUND_SCRIM = 0;
export const DEFAULT_BACKGROUND_VIDEO_URL =
  "/assets/LanternRivers_1080p15fps2Mbps3s.mp4";

// 低于此不透明度时才叠加背景可读性遮罩。
export const SURFACE_SCRIM_THRESHOLD = 95;

const BACKGROUND_SIZE_VALUES = ["cover", "contain", "auto"] as const;
const BACKGROUND_POSITION_VALUES = ["top", "center", "bottom"] as const;

export type BackgroundSize = (typeof BACKGROUND_SIZE_VALUES)[number];
export type BackgroundPosition = (typeof BACKGROUND_POSITION_VALUES)[number];

const MAX_URL_LENGTH = 2048;

// 移除可能逃出 CSS url("…") 上下文的字符；空格需由 URL 自身编码。
const UNSAFE_URL_CHARS = new RegExp("[\\x00-\\x1f\\x7f\"'`()<>\\\\\\s]", "g");

function sanitizeUrlPart(part: string): string {
  return part.replace(UNSAFE_URL_CHARS, "").slice(0, MAX_URL_LENGTH);
}

/** 规范化 `lightUrl|darkUrl`，清理两段 URL 并折叠相同值。 */
export function normalizeBackgroundUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const parts = value.split("|").map((part) => sanitizeUrlPart(part.trim()));
  const light = parts[0] ?? "";
  const dark = parts[1] ?? "";
  if (dark && dark !== light) return `${light}|${dark}`;
  return light;
}

/** 规范化单个视频 URL，拒绝非 HTTP(S) 与非站内路径。 */
export function normalizeBackgroundVideoUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const part = value.trim();
  if (!part || part.length > MAX_URL_LENGTH || /[\x00-\x20\x7f\\|]/.test(part)) {
    return "";
  }

  if (part.startsWith("/")) return part.startsWith("//") ? "" : part;

  if (!/^https?:\/\//i.test(part)) return "";
  try {
    const parsed = new URL(part);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    ) {
      return "";
    }
    return part;
  } catch {
    return "";
  }
}

export interface BackgroundVideoSourceInput {
  enabled: boolean;
  mediaType: "image" | "video";
  videoUrl: string;
  videoUrlDark: string;
  appearance: ResolvedAppearance;
  isMobile: boolean;
  reducedMotion: boolean;
  saveData: boolean;
}

/** 返回允许加载的桌面视频源；移动端与节能场景在设置 `src` 前直接截断。 */
export function resolveBackgroundVideoSource(input: BackgroundVideoSourceInput): string {
  if (
    !input.enabled ||
    input.mediaType !== "video" ||
    input.isMobile ||
    input.reducedMotion ||
    input.saveData
  ) {
    return "";
  }
  return input.appearance === "dark" ? input.videoUrlDark || input.videoUrl : input.videoUrl;
}

interface ReleasableVideo {
  pause: () => void;
  removeAttribute: (name: string) => void;
  load: () => void;
}

export function releaseBackgroundVideo(video: ReleasableVideo): void {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

/** 从规范化的单 URL 或 `light|dark` 对中选择当前外观。 */
export function resolveBackgroundUrl(
  raw: string,
  appearance: ResolvedAppearance,
): string {
  if (!raw) return "";
  const parts = raw.split("|").map((part) => part.trim());
  if (parts.length >= 2) {
    return (appearance === "dark" ? parts[1] : parts[0]) ?? "";
  }
  return parts[0] ?? "";
}

export function parseBackgroundAlignment(value: unknown): {
  size: BackgroundSize;
  position: BackgroundPosition;
} {
  const fallback = { size: "cover" as BackgroundSize, position: "center" as BackgroundPosition };
  if (typeof value !== "string") return fallback;
  const [rawSize, rawPosition] = value.split(",").map((part) => part.trim().toLowerCase());
  const size = (BACKGROUND_SIZE_VALUES as readonly string[]).includes(rawSize)
    ? (rawSize as BackgroundSize)
    : fallback.size;
  const position = (BACKGROUND_POSITION_VALUES as readonly string[]).includes(rawPosition)
    ? (rawPosition as BackgroundPosition)
    : fallback.position;
  return { size, position };
}

export function normalizeBackgroundAlignment(value: unknown): string {
  const { size, position } = parseBackgroundAlignment(value);
  return `${size},${position}`;
}

export function normalizeSurfaceOpacity(value: unknown): number {
  const num =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(num)) return DEFAULT_SURFACE_OPACITY;
  return Math.min(100, Math.max(0, Math.round(num)));
}

/**
 * 背景遮罩强度(0–100):在背景图/视频之上叠一层 `--bg-0`,暗色模式压暗、亮色模式提亮。
 * 0 = 不加遮罩(默认,保持升级前的观感)。
 */
export function normalizeBackgroundScrim(value: unknown): number {
  const num =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(num)) return DEFAULT_BACKGROUND_SCRIM;
  return Math.min(100, Math.max(0, Math.round(num)));
}

/** 由卡片不透明度推导 0–16% 的背景遮罩；高于阈值时不绘制。 */
export function computeBackgroundScrim(opacity: unknown): number {
  const resolved = normalizeSurfaceOpacity(opacity);
  if (resolved >= SURFACE_SCRIM_THRESHOLD) return 0;
  const t = (SURFACE_SCRIM_THRESHOLD - resolved) / SURFACE_SCRIM_THRESHOLD; // 取值 0–1
  return Math.round(t * 16);
}

/** 把遮罩强度写成 CSS;0 返回空串(用 transparent 兜底的那个变量值)。 */
export function backgroundScrimCss(percent: number): string {
  const resolved = normalizeBackgroundScrim(percent);
  return resolved > 0
    ? `color-mix(in srgb, var(--bg-0) ${resolved}%, transparent)`
    : "";
}

// Legacy key retained so existing users keep their saved background after the rename.
const BACKGROUND_CACHE_KEY = "monitor-luminaplus:bg";

interface BackgroundSettingsInput {
  enableBackgroundImage: boolean;
  backgroundMediaType: "image" | "video";
  backgroundImage: string;
  backgroundImageMobile: string;
  backgroundVideo: string;
  backgroundVideoDark: string;
  backgroundAlignment: string;
  surfaceOpacity: number;
  /** 浅色 / 深色模式各自的背景遮罩强度(0–100)。 */
  backgroundScrim?: number;
  backgroundScrimDark?: number;
}

/** 可直接写入 CSS 的首帧背景缓存。 */
interface BackgroundCache {
  v: 2;
  desktopVideo: boolean;
  size: string;
  position: string;
  alpha: string;
  /** 浅色模式的遮罩 CSS(含卡片透明度派生出的可读性遮罩)。 */
  scrim: string;
  /** 深色模式的遮罩 CSS;旧缓存没有这个字段,读的一侧回退到 scrim。 */
  scrimDark?: string;
  lightDesktop: string;
  lightMobile: string;
  darkDesktop: string;
  darkMobile: string;
}

function toCssUrl(url: string): string {
  return url ? `url("${url}")` : "none";
}

export function buildBackgroundCache(settings: BackgroundSettingsInput): BackgroundCache | null {
  // 视频 URL 不进入首帧缓存；只记录视频模式，以便加载阶段隐藏桌面回退图。
  if (!settings.enableBackgroundImage) return null;
  const desktopImage = {
    light: resolveBackgroundUrl(settings.backgroundImage, "light"),
    dark: resolveBackgroundUrl(settings.backgroundImage, "dark"),
  };
  const mobileImage = {
    light: resolveBackgroundUrl(settings.backgroundImageMobile, "light"),
    dark: resolveBackgroundUrl(settings.backgroundImageMobile, "dark"),
  };
  // 桌面端与移动端互为回退:只填了一侧时,另一侧用同一张图。以前只有「移动端回落桌面端」,
  // 于是只在手机端填了背景的站点在电脑端完全没有背景,看起来像两端必须分别设置。
  const lightDesktop = desktopImage.light || mobileImage.light;
  const darkDesktop = desktopImage.dark || mobileImage.dark;
  const lightMobile = mobileImage.light || desktopImage.light;
  const darkMobile = mobileImage.dark || desktopImage.dark;
  const hasVideo =
    settings.backgroundMediaType === "video" &&
    Boolean(settings.backgroundVideo || settings.backgroundVideoDark);
  if (!lightDesktop && !darkDesktop && !lightMobile && !darkMobile && !hasVideo) return null;

  const { size, position } = parseBackgroundAlignment(settings.backgroundAlignment);
  const scrimPct = computeBackgroundScrim(settings.surfaceOpacity);
  // 卡片透明时会自动叠一层可读性遮罩,站长自己的遮罩与之取较大值:两个值都是"压在背景上的
  // 底色浓度",相加会让 100% 的遮罩和自动遮罩叠加成更黑的一层,不好预期。
  const lightScrimPct = Math.max(scrimPct, normalizeBackgroundScrim(settings.backgroundScrim));
  const darkScrimPct = Math.max(scrimPct, normalizeBackgroundScrim(settings.backgroundScrimDark));
  return {
    v: 2,
    desktopVideo: hasVideo,
    size,
    position,
    alpha: String(normalizeSurfaceOpacity(settings.surfaceOpacity)),
    scrim: backgroundScrimCss(lightScrimPct),
    scrimDark: backgroundScrimCss(darkScrimPct),
    lightDesktop: toCssUrl(lightDesktop),
    lightMobile: toCssUrl(lightMobile),
    darkDesktop: toCssUrl(darkDesktop),
    darkMobile: toCssUrl(darkMobile),
  };
}

const BACKGROUND_VAR_NAMES = [
  "--bg-image-desktop",
  "--bg-image-mobile",
  "--bg-size",
  "--bg-position",
  "--surface-alpha",
  "--bg-scrim",
] as const;

/** 将缓存写入 `<html>`，与 index.html 的首帧逻辑保持一致。 */
export function applyBackgroundCache(
  cache: BackgroundCache | null,
  appearance: ResolvedAppearance,
  options: {
    isMobile: boolean;
    videoState?: "inactive" | "loading" | "playing" | "failed";
  },
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!cache) {
    for (const name of BACKGROUND_VAR_NAMES) root.style.removeProperty(name);
    return;
  }
  const dark = appearance === "dark";
  const desktopImage = dark ? cache.darkDesktop : cache.lightDesktop;
  const mobile = (dark ? cache.darkMobile : cache.lightMobile) || desktopImage;
  // 旧缓存(v2 之前只写移动端图)也要在桌面端显示出来,所以回退同时做在读的一侧。
  const desktop = desktopImage !== "none" ? desktopImage : mobile;
  const videoState = options.videoState ?? "inactive";
  const suppressDesktopImage =
    !options.isMobile && (videoState === "loading" || videoState === "playing");
  const renderedDesktop = suppressDesktopImage ? "none" : desktop;
  const selectedImage = options.isMobile ? mobile : renderedDesktop;
  const videoIsPlaying = !options.isMobile && videoState === "playing";
  const active = videoIsPlaying || selectedImage !== "none";
  // 深色模式用深色遮罩;旧缓存(v2 之前只写了一个 scrim)继续沿用同一层。
  const scrim = (dark ? (cache.scrimDark ?? cache.scrim) : cache.scrim) ?? "";
  root.style.setProperty("--bg-image-desktop", renderedDesktop);
  root.style.setProperty("--bg-image-mobile", mobile);
  root.style.setProperty("--bg-size", cache.size);
  root.style.setProperty("--bg-position", cache.position);
  if (active) {
    root.style.setProperty("--surface-alpha", cache.alpha);
    if (scrim) root.style.setProperty("--bg-scrim", scrim);
    else root.style.removeProperty("--bg-scrim");
  } else {
    root.style.removeProperty("--surface-alpha");
    root.style.removeProperty("--bg-scrim");
  }
}

export function persistBackgroundCache(cache: BackgroundCache | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (cache) localStorage.setItem(BACKGROUND_CACHE_KEY, JSON.stringify(cache));
    else localStorage.removeItem(BACKGROUND_CACHE_KEY);
  } catch {
    // 大不了下次首屏背景没缓存而已,非致命。
  }
}
