import { useEffect, useRef, useState, type CSSProperties } from "react";
import { RotateCw } from "lucide-react";

const REFRESH_THRESHOLD = 56;
const MAX_PULL = 76;
const IGNORED_TARGETS =
  "input, textarea, select, [contenteditable='true'], [role='dialog'], .uplot, [data-no-pull-refresh], .metric-color-picker, .renewal-reminder-panel";

type PullState = "idle" | "pulling" | "ready" | "refreshing" | "offline";

export function isIosStandalone(
  userAgent = navigator.userAgent,
  platform = navigator.platform,
  maxTouchPoints = navigator.maxTouchPoints,
  standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true,
  displayModeStandalone = window.matchMedia("(display-mode: standalone)").matches,
) {
  const ios = /iP(?:hone|ad|od)/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  return ios && (standalone || displayModeStandalone);
}

export function PwaPullToRefresh({ active = true }: { active?: boolean }) {
  const [state, setState] = useState<PullState>("idle");
  const [distance, setDistance] = useState(0);
  const stateRef = useRef<PullState>("idle");
  const distanceRef = useRef(0);
  const startRef = useRef({ x: 0, y: 0 });
  const trackingRef = useRef(false);
  const reloadTimerRef = useRef<number | null>(null);
  const enabled = active && isIosStandalone();

  useEffect(() => {
    if (!enabled) return;

    const update = (nextState: PullState, nextDistance: number) => {
      stateRef.current = nextState;
      distanceRef.current = nextDistance;
      setState(nextState);
      setDistance(nextDistance);
    };
    const reset = () => {
      trackingRef.current = false;
      update("idle", 0);
    };
    const onTouchStart = (event: TouchEvent) => {
      if (stateRef.current !== "idle" || event.touches.length !== 1 || window.scrollY > 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(IGNORED_TARGETS)) return;
      const touch = event.touches[0]!;
      startRef.current = { x: touch.clientX, y: touch.clientY };
      trackingRef.current = true;
      distanceRef.current = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!trackingRef.current || event.touches.length !== 1) return;
      const touch = event.touches[0]!;
      const dx = Math.abs(touch.clientX - startRef.current.x);
      const dy = touch.clientY - startRef.current.y;
      if (dy <= 0 || dx > dy || window.scrollY > 0) {
        reset();
        return;
      }
      if (dy < 6) return;
      if (event.cancelable) event.preventDefault();
      const nextDistance = Math.min(MAX_PULL, dy * 0.65);
      update(nextDistance >= REFRESH_THRESHOLD ? "ready" : "pulling", nextDistance);
    };
    const onTouchEnd = () => {
      if (!trackingRef.current) return;
      trackingRef.current = false;
      if (distanceRef.current < REFRESH_THRESHOLD) {
        reset();
        return;
      }
      if (!navigator.onLine) {
        update("offline", REFRESH_THRESHOLD);
        reloadTimerRef.current = window.setTimeout(reset, 1_200);
        return;
      }
      update("refreshing", REFRESH_THRESHOLD);
      reloadTimerRef.current = window.setTimeout(() => window.location.reload(), 180);
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", reset);
      if (reloadTimerRef.current != null) window.clearTimeout(reloadTimerRef.current);
    };
  }, [enabled]);

  if (!enabled) return null;
  const label =
    state === "ready" ? "松开刷新" : state === "refreshing" ? "正在刷新" : state === "offline" ? "网络不可用" : "下拉刷新";
  const progress = Math.min(1, distance / REFRESH_THRESHOLD);
  const style = {
    "--pull-refresh-progress": progress,
    "--pull-refresh-y": `${Math.min(10, -38 + distance * 0.8)}px`,
  } as CSSProperties;

  return (
    <div
      className="pwa-pull-refresh"
      data-state={state}
      style={style}
      aria-live="polite"
      aria-hidden={state === "idle"}
    >
      <RotateCw size={15} strokeWidth={2.2} aria-hidden />
      <span>{label}</span>
    </div>
  );
}
