/** Frame-rate meter — a pure reducer, so it is testable without a clock.
 *
 *  Counts frames inside a sliding window and republishes a whole-number rate
 *  once per window. Recomputing on every frame would make the readout jitter
 *  and cost a re-render 60×/s for a number that only needs to be legible.
 */
export type FpsState = {
  /** Frames seen since the window opened. */
  frames: number
  /** Timestamp the current window opened at, in ms. */
  since: number
  /** Last published rate. */
  fps: number
}

export const FPS_WINDOW_MS = 500

export function initialFps(): FpsState {
  // -1, not 0: `performance.now()` can legitimately be 0 on the first frame, so
  // a 0 sentinel would reopen the window forever and never publish a rate.
  return { frames: 0, since: -1, fps: 0 }
}

/** Fold one frame into the meter. Returns a new state; `fps` changes only when
 *  a window closes. `timeMs` must be monotonic (`performance.now()`). */
export function sampleFps(s: FpsState, timeMs: number, windowMs = FPS_WINDOW_MS): FpsState {
  // Opening frame: it marks t0, it is not an elapsed interval, so it is not
  // counted — counting it reports one frame per window too many.
  if (s.since < 0) return { frames: 0, since: timeMs, fps: s.fps }

  const frames = s.frames + 1
  const elapsed = timeMs - s.since
  if (elapsed < windowMs) return { frames, since: s.since, fps: s.fps }

  return { frames: 0, since: timeMs, fps: Math.round((frames * 1000) / elapsed) }
}
