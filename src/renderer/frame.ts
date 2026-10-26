import type { GameState } from '../features/game/types.ts'
import { type FrameSnapshot, snapshotFrame } from './snapshot.ts'
import { detectAndSpawnEffects, drawVisualEffects, shakeOffset, updateVisualEffects, type VisualEffects } from './particles.ts'
import { drawFrame, type Star } from './canvas.ts'
import type { Audio } from './audio.ts'

/** Screens the simulation advances on. */
export const LIVE_SCREENS = new Set<GameState['screen']>(['playing', 'dying', 'waveClear'])
/** Screens that mean the run is over for good — `paused` is deliberately not
 *  one of them, or pausing would bank an in-progress score as the hi-score. */
export const END_SCREENS = new Set<GameState['screen']>(['gameOver', 'nameEntry'])
/** Screens fully covered by an overlay card — gameplay is not drawn under it. */
export const OVERLAY_SCREENS = new Set<GameState['screen']>([
  'title',
  'gameOver',
  'paused',
  'nameEntry',
])

export const TICK_MS = 1000 / 60
/** Most ticks one frame may run — after a long stall the game jumps rather
 *  than fast-forwarding through seconds of play the player never saw. */
export const MAX_STEPS = 4

/** Fixed-timestep accumulator: the simulation runs at 60 Hz whatever the
 *  display refreshes at — a 144 Hz monitor must not play 2.4x faster. */
export function fixedSteps(acc: number, dtMs: number): { steps: number; acc: number } {
  // A 60 Hz display reports 16.4–16.9 ms: snap it, or jitter alternates 0 and
  // 2 ticks and the march visibly stutters.
  const total = acc + (Math.abs(dtMs - TICK_MS) < 0.5 ? TICK_MS : dtMs)
  const steps = Math.floor(total / TICK_MS)
  if (steps > MAX_STEPS) return { steps: MAX_STEPS, acc: 0 }
  return { steps, acc: total - steps * TICK_MS }
}

export type FrameDeps = {
  ctx: CanvasRenderingContext2D
  /** Live state — read fresh on every access. */
  state: GameState
  /** Last frame's frozen snapshot, or null on the very first frame. */
  prev: FrameSnapshot | null
  fx: VisualEffects
  stars: Star[]
  audio: Audio
  scale: number
  timeMs: number
  tick: () => void
  /** Simulation ticks owed this frame (fixed 60 Hz, see fixedSteps). Default 1. */
  steps?: number
  recordScore: (score: number) => void
}

/** One frame: advance, bank a finished run, then diff-driven effects, draw and
 *  sound. Extracted from the rAF callback so it can be tested — the harness has
 *  no `requestAnimationFrame`, so anything left inside the callback is dead to
 *  the test suite (which is how the pause-banks-hi-score bug got in).
 *
 *  Returns the snapshot to use as `prev` next frame. */
export function frame(d: FrameDeps): FrameSnapshot {
  const { ctx, state, prev, fx, stars, audio, scale, timeMs } = d

  for (let i = 0; i < (d.steps ?? 1) && LIVE_SCREENS.has(state.screen); i++) d.tick()

  const justEnded = prev !== null && LIVE_SCREENS.has(prev.screen) && END_SCREENS.has(state.screen)
  if (justEnded && !state.isReplay) d.recordScore(state.score)

  detectAndSpawnEffects(fx, prev, state)
  updateVisualEffects(fx)
  const { dx, dy } = shakeOffset(fx)
  ctx.save()
  ctx.translate(dx * scale, dy * scale)
  drawFrame(ctx, state, scale, stars, timeMs)
  // Overlay screens draw the backdrop only (game/script.js:759-761) — stray
  // particles must not bleed through the title or game-over card.
  if (!OVERLAY_SCREENS.has(state.screen)) drawVisualEffects(ctx, fx, scale)
  ctx.restore()
  audio.playSounds(prev, state)
  audio.music(state)

  return snapshotFrame(state)
}
