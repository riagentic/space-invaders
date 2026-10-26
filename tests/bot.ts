/** A scripted player for measuring the difficulty curve — a stand-in for a
 *  skilled human, deliberately not a perfect one:
 *  - decides every REACT frames (~0.1 s), not every frame
 *  - only sees bombs within VISION px above the cannon
 *  - dodges by projecting each visible bomb straight down
 *  - otherwise chases the nearest invader, aiming ahead of it
 *  It holds fire under its own shields and ignores power-ups. Used by tests/difficulty.test.ts and
 *  scripts/difficulty.ts. */
import type { GameState } from '../src/features/game/types.ts'
import { initialGameState, moveCadence, resetGame, startWave, step, strideFor } from '../src/features/game/step.ts'
import { BULLET_SPEED, PLAYER_SPEED, VW, waveTuning } from '../src/features/game/constants.ts'

export const REACT = 6
export const VISION = 150
const HORIZON = 24
const MARGIN = 4

/** Frames until the first visible bomb would hit the cannon if it moved `dir`
 *  for the whole horizon; Infinity when that path is clear. */
function hitTime(s: GameState, dir: number): number {
  const p = s.player
  const fall = waveTuning(s.wave).bomb
  let first = Infinity
  for (const b of s.invaderBullets) {
    if (b.y < p.y - VISION) continue
    for (let t = 1; t <= HORIZON; t++) {
      const px = Math.max(5, Math.min(VW - p.w - 5, p.x + dir * PLAYER_SPEED * t))
      const by = b.y + fall * t
      if (by + b.h >= p.y && by <= p.y + p.h && b.x + b.w >= px - MARGIN && b.x <= px + p.w + MARGIN) {
        first = Math.min(first, t)
        break
      }
    }
  }
  return first
}

/** True if a shot fired from `x` would hit a shield before anything else. */
function shieldBlocks(s: GameState, x: number): boolean {
  return s.shields.some((sh) => sh.some((px) => px.alive && x + 2 >= px.x && x - 2 <= px.x + px.w))
}

function decide(s: GameState): number {
  const p = s.player
  const cx = p.x + p.w / 2
  let target = cx
  let best = Infinity
  // Nearest invader with a clear line of fire, led by where it will be when
  // the shot arrives — a skilled player aims ahead of a fast target.
  const alive = s.invaders.filter((i) => i.alive).length
  const speed = s.invaderDir * strideFor(s, alive) / moveCadence(s.invaderMoveInterval, alive)
  for (const inv of s.invaders) {
    if (!inv.alive) continue
    const x = inv.x + 15 + speed * (p.y - inv.y) / BULLET_SPEED
    const d = Math.abs(x - cx) + (shieldBlocks(s, x) ? VW : 0)
    if (d < best) {
      best = d
      target = x
    }
  }
  const want = Math.abs(target - cx) < PLAYER_SPEED ? 0 : Math.sign(target - cx)
  // Safest move first; among equally safe, the one toward the target.
  const options = [want, 0, -1, 1].filter((d, i, a) => a.indexOf(d) === i)
  let pick = want
  let latest = -1
  for (const d of options) {
    const t = hitTime(s, d)
    if (t > latest) {
      latest = t
      pick = d
    }
  }
  return pick
}

export type WaveResult = { cleared: boolean; frames: number; livesLost: number; left: number }

/** Play one wave from a fresh cannon with `lives` lives. */
export function playWave(wave: number, seed: number, lives = 3, maxFrames = 60 * 180): WaveResult {
  const s = initialGameState()
  resetGame(s, seed)
  s.wave = wave
  s.lives = lives
  startWave(s)
  let dir = 0
  let frames = 0
  for (; frames < maxFrames; frames++) {
    if (s.screen === 'playing' && frames % REACT === 0) dir = decide(s)
    const cx = s.player.x + s.player.w / 2
    s.input = { left: dir < 0, right: dir > 0, shoot: !shieldBlocks(s, cx) }
    step(s)
    if (s.screen === 'waveClear') return { cleared: true, frames, livesLost: lives - s.lives, left: 0 }
    if (s.screen === 'gameOver' || s.screen === 'nameEntry') break
  }
  return { cleared: false, frames, livesLost: lives - s.lives, left: s.invaders.filter((i) => i.alive).length }
}

/** Clear rate of `wave` over `runs` seeds. */
export function clearRate(wave: number, runs: number, seed0 = 1): number {
  let cleared = 0
  for (let i = 0; i < runs; i++) if (playWave(wave, seed0 + i * 7919).cleared) cleared++
  return cleared / runs
}
