import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
import { destroyShieldArea, rectsOverlap } from '../src/features/game/collision.ts'
import { createInvaders, createShields } from '../src/features/game/factory.ts'
import { nextRandom } from '../src/features/game/rng.ts'
import { computeScale } from '../src/renderer/resize.ts'
import {
  createVisualEffects,
  POPUP_LIFE,
  spawnExplosion,
  spawnPopup,
  updateVisualEffects,
} from '../src/renderer/particles.ts'
import { snapshotFrame } from '../src/renderer/snapshot.ts'
import { initialFps, sampleFps } from '../src/renderer/fps.ts'
import { initialGameState, resetGame } from '../src/features/game/step.ts'
import { LEADERBOARD_SIZE, qualifyThreshold } from '../src/features/scores/index.ts'
import { INVADER_COLS, INVADER_ROWS, SHIELD_COUNT, VW } from '../src/features/game/constants.ts'

// ── collision ───────────────────────────────────────────────────────────────

Deno.test('rectsOverlap: overlapping rects', () => {
  assert(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }))
})

Deno.test('rectsOverlap: edge-touching rects do not count as overlapping', () => {
  assertEquals(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), false)
})

Deno.test('rectsOverlap: disjoint rects', () => {
  assertEquals(rectsOverlap({ x: 0, y: 0, w: 4, h: 4 }, { x: 100, y: 100, w: 4, h: 4 }), false)
})

Deno.test('destroyShieldArea: kills pixels inside the radius and spares the rest', () => {
  const shield = [
    { x: 0, y: 0, w: 4, h: 4, alive: true }, // distance 0 — dies
    { x: 5, y: 0, w: 4, h: 4, alive: true }, // distance 5 — dies (< 8)
    { x: 40, y: 0, w: 4, h: 4, alive: true }, // distance 40 — survives
  ]
  destroyShieldArea(shield, 0, 0, 8)
  assertEquals(shield.map((p) => p.alive), [false, false, true])
})

Deno.test('destroyShieldArea: already-dead pixels stay dead and are skipped', () => {
  const shield = [{ x: 0, y: 0, w: 4, h: 4, alive: false }]
  destroyShieldArea(shield, 0, 0, 8)
  assertEquals(shield[0].alive, false)
})

// ── factory ─────────────────────────────────────────────────────────────────

Deno.test('createInvaders: a full 5x11 grid, all alive, points by row', () => {
  const invaders = createInvaders()
  assertEquals(invaders.length, INVADER_ROWS * INVADER_COLS)
  assert(invaders.every((i) => i.alive))
  assertEquals(invaders.filter((i) => i.row === 0).length, INVADER_COLS)
  assertEquals([0, 1, 2, 3, 4].map((r) => invaders.find((i) => i.row === r)!.points), [
    40,
    20,
    20,
    10,
    10,
  ])
})

Deno.test('createInvaders: every (row, col) slot is filled exactly once', () => {
  const seen = new Set(createInvaders().map((i) => `${i.row}:${i.col}`))
  assertEquals(seen.size, INVADER_ROWS * INVADER_COLS)
})

Deno.test('createShields: four intact shields, evenly spaced', () => {
  const shields = createShields()
  assertEquals(shields.length, SHIELD_COUNT)
  assert(shields.every((s) => s.length > 0 && s.every((p) => p.alive)))
  const centres = shields.map((s) => s[0].x)
  const gaps = centres.slice(1).map((c, i) => c - centres[i])
  for (const gap of gaps) assertAlmostEquals(gap, VW / (SHIELD_COUNT + 1), 0.001)
})

// ── rng ─────────────────────────────────────────────────────────────────────

Deno.test('nextRandom: same seed produces the same sequence', () => {
  const draw = (seed: number) => {
    const s = { rngSeed: seed }
    return Array.from({ length: 20 }, () => nextRandom(s))
  }
  assertEquals(draw(12345), draw(12345))
})

Deno.test('nextRandom: different seeds diverge, and draws stay in [0, 1)', () => {
  const a = { rngSeed: 1 }
  const b = { rngSeed: 999 }
  const drawsA = Array.from({ length: 20 }, () => nextRandom(a))
  const drawsB = Array.from({ length: 20 }, () => nextRandom(b))
  assert(drawsA.some((v, i) => v !== drawsB[i]))
  for (const v of [...drawsA, ...drawsB]) assert(v >= 0 && v < 1, `draw out of range: ${v}`)
})

// ── resize ──────────────────────────────────────────────────────────────────

Deno.test('computeScale: letterboxes a wide window and keeps the canvas aspect', () => {
  const s = computeScale(1600, 900)
  assertAlmostEquals(s.scale, s.wrapperW / VW, 0.0001)
  assert(s.wrapperW <= 1600 && s.wrapperH <= 900)
  assertAlmostEquals(s.canvasH, s.wrapperH - 44 * s.scale, 0.0001)
  assertEquals(s.canvasW, s.wrapperW)
})

Deno.test('computeScale: pillarboxes a tall window', () => {
  const s = computeScale(400, 1200)
  assertAlmostEquals(s.scale, s.wrapperW / VW, 0.0001)
  assert(s.wrapperW <= 400, `wrapper ${s.wrapperW} must fit the window`)
})

Deno.test('computeScale: a width-constrained window fills the width minus padding', () => {
  // Both windows are far taller than the 640x524 aspect, so width is the limit.
  for (const w of [800, 1600]) {
    const s = computeScale(w, 4000)
    assertAlmostEquals(s.wrapperW, w - 16, 0.0001)
    assertAlmostEquals(s.scale, (w - 16) / VW, 0.0001)
  }
})

// ── particles ───────────────────────────────────────────────────────────────

Deno.test('spawnExplosion: emits the requested particle count', () => {
  const fx = createVisualEffects()
  spawnExplosion(fx, 0, 0, '#fff', 16, () => 0.5)
  assertEquals(fx.particles.length, 16)
})

Deno.test('updateVisualEffects: particles decay to nothing', () => {
  const fx = createVisualEffects()
  spawnExplosion(fx, 0, 0, '#fff', 8, () => 0)
  // decay = 0.02 + 0*0.03 → 50 updates take life from 1 to 0.
  for (let i = 0; i < 60; i++) updateVisualEffects(fx)
  assertEquals(fx.particles.length, 0)
})

Deno.test('updateVisualEffects: popups rise and expire after POPUP_LIFE frames', () => {
  const fx = createVisualEffects()
  spawnPopup(fx, 10, 20, '40', '#fff')
  updateVisualEffects(fx)
  assertEquals(fx.popups[0].y, 19.5)
  for (let i = 0; i < POPUP_LIFE; i++) updateVisualEffects(fx)
  assertEquals(fx.popups.length, 0)
})

// ── snapshot ────────────────────────────────────────────────────────────────

Deno.test('snapshotFrame: copies values, so later mutation cannot change it', () => {
  const s = initialGameState()
  resetGame(s, 42)
  const snap = snapshotFrame(s)
  assertEquals(snap.aliveCount, INVADER_ROWS * INVADER_COLS)
  assertEquals(snap.screen, 'playing')

  // Mutate the live state the way a frame would.
  s.invaders[0].alive = false
  s.score = 40
  s.screen = 'dying'

  // The snapshot must still describe the PREVIOUS frame — this is exactly the
  // property that a live cell view fails to provide.
  assertEquals(snap.aliveCount, INVADER_ROWS * INVADER_COLS)
  assertEquals(snap.aliveMask[0], true)
  assertEquals(snap.score, 0)
  assertEquals(snap.screen, 'playing')
})

Deno.test('snapshotFrame: ufo position is copied, not referenced', () => {
  const s = initialGameState()
  s.ufo = { x: 10, y: 25, dir: 1 }
  const snap = snapshotFrame(s)
  s.ufo.x = 999
  assertEquals(snap.ufo?.x, 10)
})

// ── scores ──────────────────────────────────────────────────────────────────

Deno.test('qualifyThreshold: 0 while the board has a free slot', () => {
  assertEquals(qualifyThreshold([]), 0)
  const partial = Array.from({ length: LEADERBOARD_SIZE - 1 }, (_, i) => ({
    name: 'AAAA',
    score: 100 + i,
    wave: 1,
  }))
  assertEquals(qualifyThreshold(partial), 0)
})

Deno.test('qualifyThreshold: the lowest score on a full board', () => {
  const full = Array.from({ length: LEADERBOARD_SIZE }, (_, i) => ({
    name: 'AAAA',
    score: 500 - i * 100,
    wave: 1,
  }))
  assertEquals(qualifyThreshold(full), 100)
})

// ── fps meter ───────────────────────────────────────────────────────────────

Deno.test('sampleFps: the opening frame marks t0 and is not counted', () => {
  const s = sampleFps(initialFps(), 1000)
  assertEquals(s.frames, 0, 'the opener is not an elapsed interval')
  assertEquals(s.since, 1000)
  assertEquals(s.fps, 0)
})

Deno.test('sampleFps: a timestamp of exactly 0 still opens the window', () => {
  // performance.now() can legitimately be 0 on the first frame.
  let s = sampleFps(initialFps(), 0)
  assertEquals(s.since, 0)
  for (let i = 1; i <= 30; i++) s = sampleFps(s, (i * 1000) / 60)
  assertEquals(s.fps, 60, 'a 0 sentinel would have blocked publishing forever')
})

Deno.test('sampleFps: holds the last rate until the window closes', () => {
  let s = sampleFps(initialFps(), 0)
  for (let i = 1; i < 10; i++) s = sampleFps(s, i * 16)
  assertEquals(s.fps, 0, 'nothing published inside the first window')
  assertEquals(s.frames, 9)
})

Deno.test('sampleFps: a steady 60fps feed reports 60', () => {
  let s = sampleFps(initialFps(), 0)
  for (let i = 1; i <= 40; i++) s = sampleFps(s, (i * 1000) / 60)
  assertEquals(s.fps, 60)
})

Deno.test('sampleFps: a steady 30fps feed reports 30', () => {
  let s = sampleFps(initialFps(), 0)
  for (let i = 1; i <= 25; i++) s = sampleFps(s, (i * 1000) / 30)
  assertEquals(s.fps, 30)
})

Deno.test('sampleFps: a halved frame rate is reported after the next window', () => {
  let s = sampleFps(initialFps(), 0)
  for (let i = 1; i <= 30; i++) s = sampleFps(s, (i * 1000) / 60)
  assertEquals(s.fps, 60)
  // Now feed 20fps for a full window on top of the 500ms already elapsed.
  let t = 500
  while (t < 1000) {
    t += 50
    s = sampleFps(s, t)
  }
  assertEquals(s.fps, 20)
})

Deno.test('sampleFps: the window restarts at the publishing frame', () => {
  let s = sampleFps(initialFps(), 0)
  for (let i = 1; i <= 30; i++) s = sampleFps(s, (i * 1000) / 60)
  assertEquals(s.fps, 60)
  assertEquals(s.frames, 0, 'counter reset')
  assertEquals(s.since, 500, 'window reopened at the frame that published')
})
