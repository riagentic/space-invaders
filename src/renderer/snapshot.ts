import type { GameState, Screen } from '../features/game/types.ts'

/** A frozen, cheap copy of everything the frame-to-frame effect detectors
 *  compare.
 *
 *  Why this exists: reading a cell gives a *live view* of state, not a
 *  per-frame value. Stashing that view as "the previous frame" and diffing it
 *  against the current one compares the state to itself, so every transition
 *  reads as "nothing changed" — which silently killed every explosion, score
 *  popup, sound effect and the music. Copying the handful of fields the
 *  detectors actually read costs one small array per frame and makes the diff
 *  real again.
 */
export type FrameSnapshot = {
  screen: Screen
  score: number
  lives: number
  rapid: number
  triple: number
  shield: boolean
  hasPowerUp: boolean
  ufoHits: number
  hasPlayerBullet: boolean
  /** Per-invader alive flags, positionally matching `GameState.invaders`. */
  aliveMask: boolean[]
  aliveCount: number
  ufo: { x: number; y: number } | null
}

/** Screens of a run in progress. A change between two of them is gameplay; a
 *  change across the boundary (restart, quit, replay) is a reset and must not
 *  read as an event — or a restart would "gain" lives and "kill" invaders. */
export const RUN_SCREENS = new Set<Screen>(['playing', 'dying', 'waveClear', 'paused'])
export const sameRun = (prev: FrameSnapshot, next: GameState): boolean =>
  RUN_SCREENS.has(prev.screen) && RUN_SCREENS.has(next.screen)

export function snapshotFrame(s: GameState): FrameSnapshot {
  const aliveMask = s.invaders.map((inv) => inv.alive)
  let aliveCount = 0
  for (const alive of aliveMask) if (alive) aliveCount++
  return {
    screen: s.screen,
    score: s.score,
    lives: s.lives,
    rapid: s.player.rapid,
    triple: s.player.triple,
    shield: s.player.shield,
    hasPowerUp: s.powerUp !== null,
    ufoHits: s.ufoHits,
    hasPlayerBullet: s.player.bullet !== null,
    aliveMask,
    aliveCount,
    ufo: s.ufo ? { x: s.ufo.x, y: s.ufo.y } : null,
  }
}
