import { describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_VIDEO_FIRST_FRAME_TIMEOUT_MS,
  createBackgroundVideoSession,
  type BackgroundVideoSessionEvent,
  type BackgroundVideoSessionState,
  type BackgroundVideoSessionTarget,
} from "@/utils/backgroundVideoSession";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHarness(hiddenAtStart = false) {
  const videoListeners = new Map<BackgroundVideoSessionEvent, Set<() => void>>();
  const visibilityListeners = new Set<() => void>();
  let hidden = hiddenAtStart;

  const video: BackgroundVideoSessionTarget = {
    src: "",
    load: vi.fn(),
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    addEventListener: vi.fn((type, listener) => {
      const listeners = videoListeners.get(type) ?? new Set<() => void>();
      listeners.add(listener);
      videoListeners.set(type, listeners);
    }),
    removeEventListener: vi.fn((type, listener) => {
      videoListeners.get(type)?.delete(listener);
    }),
  };
  const onStateChange = vi.fn<(state: BackgroundVideoSessionState) => void>();
  const release = vi.fn<() => void>();
  const subscribeVisibility = vi.fn((listener: () => void) => {
    visibilityListeners.add(listener);
    return () => visibilityListeners.delete(listener);
  });

  return {
    video,
    onStateChange,
    release,
    subscribeVisibility,
    isHidden: () => hidden,
    emitVideo(type: BackgroundVideoSessionEvent) {
      for (const listener of [...(videoListeners.get(type) ?? [])]) listener();
    },
    setHidden(next: boolean) {
      hidden = next;
      for (const listener of [...visibilityListeners]) listener();
    },
    getVideoListeners(type: BackgroundVideoSessionEvent) {
      return [...(videoListeners.get(type) ?? [])];
    },
    getVisibilityListeners() {
      return [...visibilityListeners];
    },
  };
}

function start(harness: ReturnType<typeof createHarness>) {
  return createBackgroundVideoSession({
    video: harness.video,
    source: "/background.mp4",
    onStateChange: harness.onStateChange,
    isHidden: harness.isHidden,
    subscribeVisibility: harness.subscribeVisibility,
    release: harness.release,
  });
}

describe("createBackgroundVideoSession", () => {
  it("keeps the last presented frame visible across loop waiting events", () => {
    const harness = createHarness();
    const session = start(harness);

    expect(harness.video.src).toBe("/background.mp4");
    expect(harness.video.load).toHaveBeenCalledOnce();
    expect(harness.video.play).toHaveBeenCalledOnce();
    expect(harness.onStateChange).toHaveBeenLastCalledWith("loading");

    harness.emitVideo("playing");
    expect(harness.onStateChange).toHaveBeenLastCalledWith("playing");
    const stateCallsBeforeWaiting = harness.onStateChange.mock.calls.length;
    harness.emitVideo("waiting");
    expect(harness.onStateChange).toHaveBeenLastCalledWith("playing");
    expect(harness.onStateChange).toHaveBeenCalledTimes(stateCallsBeforeWaiting);

    const stateCalls = harness.onStateChange.mock.calls.length;
    harness.emitVideo("stalled");
    // No stalled listener is registered: download stalls alone do not prove playback stopped.
    expect(harness.getVideoListeners("stalled")).toHaveLength(0);
    expect(harness.onStateChange).toHaveBeenCalledTimes(stateCalls);

    harness.emitVideo("playing");
    expect(harness.onStateChange).toHaveBeenLastCalledWith("playing");
    session.dispose();
  });

  it("pauses while hidden and retries when the document becomes visible", () => {
    const harness = createHarness(true);
    const session = start(harness);

    expect(harness.video.pause).toHaveBeenCalledOnce();
    expect(harness.video.play).not.toHaveBeenCalled();

    harness.setHidden(false);
    expect(harness.video.play).toHaveBeenCalledOnce();
    harness.emitVideo("playing");
    expect(harness.onStateChange).toHaveBeenLastCalledWith("playing");

    harness.setHidden(true);
    expect(harness.video.pause).toHaveBeenCalledTimes(2);
    expect(harness.onStateChange).toHaveBeenLastCalledWith("playing");
    session.dispose();
  });

  it("stays loading when waiting fires before the first frame", () => {
    const harness = createHarness();
    const session = start(harness);
    const stateCalls = harness.onStateChange.mock.calls.length;

    harness.emitVideo("waiting");

    expect(harness.onStateChange).toHaveBeenLastCalledWith("loading");
    expect(harness.onStateChange).toHaveBeenCalledTimes(stateCalls);
    session.dispose();
  });

  it("fails and restores the fallback when the first frame never arrives", () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const session = start(harness);

      vi.advanceTimersByTime(BACKGROUND_VIDEO_FIRST_FRAME_TIMEOUT_MS - 1);
      expect(harness.release).not.toHaveBeenCalled();
      expect(harness.onStateChange).toHaveBeenLastCalledWith("loading");

      vi.advanceTimersByTime(1);
      expect(harness.onStateChange).toHaveBeenLastCalledWith("failed");
      expect(harness.release).toHaveBeenCalledOnce();
      session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the first-frame timeout after playback starts", () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const session = start(harness);

      harness.emitVideo("playing");
      vi.advanceTimersByTime(BACKGROUND_VIDEO_FIRST_FRAME_TIMEOUT_MS);

      expect(harness.onStateChange).toHaveBeenLastCalledWith("playing");
      expect(harness.release).not.toHaveBeenCalled();
      session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not count hidden time toward the first-frame timeout", () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness(true);
      const session = start(harness);

      vi.advanceTimersByTime(BACKGROUND_VIDEO_FIRST_FRAME_TIMEOUT_MS);
      expect(harness.release).not.toHaveBeenCalled();

      harness.setHidden(false);
      vi.advanceTimersByTime(BACKGROUND_VIDEO_FIRST_FRAME_TIMEOUT_MS);
      expect(harness.onStateChange).toHaveBeenLastCalledWith("failed");
      expect(harness.release).toHaveBeenCalledOnce();
      session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a hidden pending play AbortError and retries on visibility", async () => {
    const harness = createHarness();
    const firstPlay = deferred<void>();
    vi.mocked(harness.video.play)
      .mockReturnValueOnce(firstPlay.promise)
      .mockResolvedValue(undefined);
    const session = start(harness);

    harness.setHidden(true);
    firstPlay.reject(new DOMException("paused", "AbortError"));
    await Promise.resolve();
    expect(harness.release).not.toHaveBeenCalled();

    harness.setHidden(false);
    expect(harness.video.play).toHaveBeenCalledTimes(2);
    expect(harness.release).not.toHaveBeenCalled();
    session.dispose();
  });

  it("releases once on media errors and non-Abort play rejections", async () => {
    const rejectedHarness = createHarness();
    vi.mocked(rejectedHarness.video.play).mockRejectedValueOnce(new Error("blocked"));
    const rejectedSession = start(rejectedHarness);
    await Promise.resolve();
    expect(rejectedHarness.onStateChange).toHaveBeenLastCalledWith("failed");
    expect(rejectedHarness.release).toHaveBeenCalledOnce();
    rejectedSession.dispose();
    expect(rejectedHarness.release).toHaveBeenCalledOnce();

    const errorHarness = createHarness();
    const errorSession = start(errorHarness);
    errorHarness.emitVideo("playing");
    errorHarness.emitVideo("error");
    expect(errorHarness.onStateChange).toHaveBeenLastCalledWith("failed");
    expect(errorHarness.release).toHaveBeenCalledOnce();
    errorHarness.emitVideo("error");
    errorSession.dispose();
    expect(errorHarness.release).toHaveBeenCalledOnce();
  });

  it("invalidates event, visibility, and play callbacks after dispose", async () => {
    const harness = createHarness();
    const pendingPlay = deferred<void>();
    vi.mocked(harness.video.play).mockReturnValueOnce(pendingPlay.promise);
    const session = start(harness);
    const oldPlaying = harness.getVideoListeners("playing")[0];
    const oldWaiting = harness.getVideoListeners("waiting")[0];
    const oldError = harness.getVideoListeners("error")[0];
    const oldVisibility = harness.getVisibilityListeners()[0];

    harness.emitVideo("playing");
    session.dispose();
    expect(harness.onStateChange).toHaveBeenLastCalledWith("playing");
    expect(harness.release).toHaveBeenCalledOnce();
    harness.onStateChange.mockClear();

    oldPlaying?.();
    oldWaiting?.();
    oldError?.();
    oldVisibility?.();
    pendingPlay.reject(new Error("late failure"));
    await Promise.resolve();

    expect(harness.onStateChange).not.toHaveBeenCalled();
    expect(harness.video.play).toHaveBeenCalledOnce();
    expect(harness.release).toHaveBeenCalledOnce();
    session.dispose();
    expect(harness.release).toHaveBeenCalledOnce();
  });
});
