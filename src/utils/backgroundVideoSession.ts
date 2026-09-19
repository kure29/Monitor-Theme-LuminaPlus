export type BackgroundVideoSessionEvent = "playing" | "waiting" | "stalled" | "error";
export type BackgroundVideoSessionState = "loading" | "playing" | "failed";

export const BACKGROUND_VIDEO_FIRST_FRAME_TIMEOUT_MS = 20_000;

export interface BackgroundVideoSessionTarget {
  src: string;
  load: () => void;
  play: () => Promise<void>;
  pause: () => void;
  addEventListener: (type: BackgroundVideoSessionEvent, listener: () => void) => void;
  removeEventListener: (type: BackgroundVideoSessionEvent, listener: () => void) => void;
}

export interface BackgroundVideoSessionOptions {
  video: BackgroundVideoSessionTarget;
  source: string;
  onStateChange: (state: BackgroundVideoSessionState) => void;
  isHidden: () => boolean;
  subscribeVisibility: (listener: () => void) => () => void;
  release: () => void;
}

export interface BackgroundVideoSession {
  dispose: () => void;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

/** Owns one video source from assignment through release. All browser state is injected. */
export function createBackgroundVideoSession({
  video,
  source,
  onStateChange,
  isHidden,
  subscribeVisibility,
  release,
}: BackgroundVideoSessionOptions): BackgroundVideoSession {
  if (!source) throw new Error("Background video source is required");

  let active = true;
  let failed = false;
  let released = false;
  let hasPresentedFrame = false;
  let state: BackgroundVideoSessionState | null = null;
  let playAttempt = 0;
  let firstFrameTimeout: ReturnType<typeof setTimeout> | null = null;

  const clearFirstFrameTimeout = () => {
    if (firstFrameTimeout === null) return;
    clearTimeout(firstFrameTimeout);
    firstFrameTimeout = null;
  };

  const setState = (next: BackgroundVideoSessionState) => {
    if (!active || state === next) return;
    state = next;
    onStateChange(next);
  };

  const releaseOnce = () => {
    if (released) return;
    released = true;
    release();
  };

  const fail = () => {
    if (!active || failed) return;
    failed = true;
    playAttempt += 1;
    clearFirstFrameTimeout();
    setState("failed");
    releaseOnce();
  };

  const armFirstFrameTimeout = () => {
    if (hasPresentedFrame || firstFrameTimeout !== null) return;
    firstFrameTimeout = setTimeout(() => {
      firstFrameTimeout = null;
      fail();
    }, BACKGROUND_VIDEO_FIRST_FRAME_TIMEOUT_MS);
  };

  const handlePlayRejection = (attempt: number, error: unknown) => {
    if (!active || failed || attempt !== playAttempt) return;
    if (isHidden() || isAbortError(error)) return;
    fail();
  };

  const tryPlay = () => {
    if (!active || failed || isHidden()) return;
    armFirstFrameTimeout();
    const attempt = ++playAttempt;
    try {
      void video.play().catch((error: unknown) => handlePlayRejection(attempt, error));
    } catch (error) {
      handlePlayRejection(attempt, error);
    }
  };

  const handlePlaying = () => {
    if (!active || failed) return;
    clearFirstFrameTimeout();
    if (isHidden()) {
      playAttempt += 1;
      video.pause();
      if (!hasPresentedFrame) setState("loading");
      return;
    }
    hasPresentedFrame = true;
    setState("playing");
  };
  // Native loop playback may emit `waiting` while seeking back to the first frame.
  // Once a frame has been presented, keep it visible instead of flashing the fallback.
  const handleWaiting = () => {
    if (!hasPresentedFrame) setState("loading");
  };
  const handleError = () => fail();
  const handleVisibilityChange = () => {
    if (!active || failed) return;
    if (isHidden()) {
      playAttempt += 1;
      clearFirstFrameTimeout();
      video.pause();
      if (!hasPresentedFrame) setState("loading");
      return;
    }
    tryPlay();
  };

  setState("loading");
  video.addEventListener("playing", handlePlaying);
  video.addEventListener("waiting", handleWaiting);
  video.addEventListener("error", handleError);
  video.src = source;
  video.load();
  const unsubscribeVisibility = subscribeVisibility(handleVisibilityChange);
  handleVisibilityChange();

  return {
    dispose() {
      if (!active) return;
      active = false;
      playAttempt += 1;
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("error", handleError);
      unsubscribeVisibility();
      clearFirstFrameTimeout();
      releaseOnce();
    },
  };
}
