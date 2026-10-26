/** The Space Invaders simulation — plain TypeScript, no framework imports.
 *
 *  Every function here mutates the state object it is given and returns
 *  nothing. That is the Immer-draft contract the `game` cell relies on
 *  (see dep/aio/docs/state/cells.md#sync-methods): mutate the draft, get an
 *  immutable commit. Because nothing here imports aio, the engine is also a
 *  standalone module — `step()` is a pure state transition given a seed and an
 *  input tape, which is exactly what makes replay possible.
 */
import type { Bullet, GameState, InputKey, PowerKind, ReplayTape } from './types.ts'
import { createInvaders, createShields } from './factory.ts'
import { destroyShieldArea, rectsOverlap } from './collision.ts'
import { nextRandom } from './rng.ts'
import {
  BASE_MOVE_INTERVAL,
  BULLET_H,
  BULLET_SPEED,
  BULLET_W,
  INVADER_DROP,
  PLAYER_H,
  PLAYER_SPEED,
  PLAYER_W,
  PLAYER_Y,
  UFO_INTERVAL,
  UFO_SPEED,
  VH,
  VW,
  waveTuning,
} from './constants.ts'

/** Invader hit box. Deliberately shorter than the drawn sprite (10x8 cells at
 *  scale 3 = 30x24): the original game shoots against 30x21
 *  (game/script.js:631,684) but tests the invasion line against `y + 24`
 *  (game/script.js:674). Kept as-is for fidelity — widening the hit box would
 *  change how the game plays. */
export const INVADER_W = 30
export const INVADER_H = 21
/** Sprite height, used for the invasion line — see the note above. */
export const INVADER_SPRITE_H = 24
/** UFO hit box (game/script.js:645). */
export const UFO_W = 42
export const UFO_H = 21

/** Invader advance: base stride in px, plus a ramp as the grid thins out
 *  (game/script.js:566-571). */
export const BASE_STRIDE = 8
export const STRIDE_RAMP = 0.1
export const TOTAL_INVADERS = 55
/** The last invader alive runs this many times the wave's sprint speed. */
export const FINAL_BOOST = 3

/** Bonus cannon, once per run — the cabinet's classic 1500-point reward. */
export const EXTRA_LIFE_SCORE = 1500
export const MAX_LIVES = 5

/** One kill in ten drops a power-up, one capsule at a time. */
export const POWER_CHANCE = 0.1
export const POWER_FRAMES = 600
export const POWER_FALL = 1.5
export const POWER_W = 16
export const POWER_H = 12
/** Cumulative odds, rarest last. */
export const POWER_TABLE: [number, PowerKind][] = [[0.34, 'rapid'], [0.62, 'triple'], [0.88, 'shield'], [1, 'life']]
export const RAPID_SPEED = 2
export const SPREAD_VX = 2.2
export const BOMB_POINTS = 5
export const WAVE_BONUS = 100

/** Invader bullet geometry, measured from the firing invader's top-left. */
export const INVADER_BULLET_DX = 12
export const INVADER_BULLET_DY = 20
export const INVADER_BULLET_W = 3
export const INVADER_BULLET_H = 10

/** How far off-screen the UFO spawns, and the lane it crosses. */
export const UFO_MARGIN = 50
export const UFO_LANE_Y = 25

export const DYING_FRAMES = 90
export const WAVE_CLEAR_FRAMES = 90
export const RESPAWN_INVINCIBLE_FRAMES = 120
export const UFO_POINTS = [50, 100, 150, 200, 300]

export function emptyTape(seed: number): ReplayTape {
  return { seed, events: [] }
}

export function initialGameState(): GameState {
  return {
    screen: 'title',
    score: 0,
    lives: 3,
    wave: 1,
    player: {
      x: VW / 2 - PLAYER_W / 2,
      y: PLAYER_Y,
      w: PLAYER_W,
      h: PLAYER_H,
      speed: PLAYER_SPEED,
      bullet: null,
      spread: [],
      invincible: 0,
      rapid: 0,
      triple: 0,
      shield: false,
    },
    powerUp: null,
    invaders: [],
    invaderDir: 1,
    invaderFrame: 0,
    invaderMoveTimer: 0,
    invaderMoveInterval: BASE_MOVE_INTERVAL,
    invaderShootChance: waveTuning(1).fire,
    invaderBullets: [],
    shields: [],
    ufo: null,
    ufoTimer: 0,
    ufoHits: 0,
    input: { left: false, right: false, shoot: false },
    rngSeed: 1,
    dyingTimer: 0,
    waveClearTimer: 0,
    frameNo: 0,
    tape: emptyTape(1),
    lastReplay: null,
    isReplay: false,
    replayCursor: 0,
    qualifyThreshold: 0,
    nameEntry: '',
    extraLifeAwarded: false,
  }
}

/** Start a fresh game from `seed`. Seed 0 would lock xorshift32 at zero
 *  forever, so it is coerced to a live value. */
export function resetGame(s: GameState, seed: number): void {
  const safeSeed = (seed >>> 0) || 1
  s.score = 0
  s.lives = 3
  s.wave = 1
  s.rngSeed = safeSeed
  s.player.x = VW / 2 - PLAYER_W / 2
  clearPowers(s)
  s.player.invincible = 0
  s.shields = createShields()
  s.extraLifeAwarded = false
  s.ufoHits = 0
  startWave(s)
  s.dyingTimer = 0
  s.waveClearTimer = 0
  s.input = { left: false, right: false, shoot: false }
  s.frameNo = 0
  s.tape = emptyTape(safeSeed)
  s.isReplay = false
  s.replayCursor = 0
  s.nameEntry = ''
  s.screen = 'playing'
}

/** Abandon the current run and return to the title screen.
 *
 *  A quit is not a game over: the score is forfeited rather than banked, and
 *  the tape is discarded, so `lastReplay` keeps pointing at the last game that
 *  actually finished. The HUD reads live state, so the run-scoped counters are
 *  reset too — otherwise the title screen would show the abandoned score. */
export function abandonRun(s: GameState): void {
  s.score = 0
  s.lives = 3
  s.wave = 1
  s.invaders = []
  s.invaderBullets = []
  s.shields = []
  s.ufo = null
  clearPowers(s)
  s.input = { left: false, right: false, shoot: false }
  s.frameNo = 0
  s.tape = emptyTape(s.rngSeed)
  s.isReplay = false
  s.replayCursor = 0
  s.nameEntry = ''
  s.screen = 'title'
}

/** Drop every shot and power — a new run, or a death. */
function clearPowers(s: GameState): void {
  s.player.bullet = null
  s.player.spread = []
  s.player.rapid = 0
  s.player.triple = 0
  s.player.shield = false
  s.powerUp = null
}

/** True if `score` earns a leaderboard slot. `qualifyThreshold` is 0 while the
 *  board has a free slot, otherwise the lowest score on it. */
export function qualifies(s: GameState): boolean {
  return s.score > 0 && s.score > s.qualifyThreshold
}

/** Record an input change so the game can be replayed later. Events are stamped
 *  with the next frame to run, which is when they take effect. */
export function recordInput(s: GameState, key: InputKey, down: boolean): void {
  if (s.isReplay) return
  s.tape.events.push({ frame: s.frameNo + 1, key, down })
}

/** Apply every recorded event scheduled for the current frame. */
function applyReplayInput(s: GameState): void {
  const tape = s.lastReplay
  if (!tape) return
  while (
    s.replayCursor < tape.events.length &&
    tape.events[s.replayCursor].frame <= s.frameNo
  ) {
    const e = tape.events[s.replayCursor]
    s.input[e.key] = e.down
    s.replayCursor++
  }
}

function endGame(s: GameState): void {
  if (s.isReplay) {
    // A replay is a viewing, not a run: it must not overwrite the tape it is
    // replaying, and its score must not be banked a second time — the original
    // already claimed its leaderboard slot.
    s.screen = 'gameOver'
    return
  }
  s.lastReplay = s.tape
  s.screen = qualifies(s) ? 'nameEntry' : 'gameOver'
}

/** Advance the simulation one frame. */
export function step(s: GameState): void {
  if (s.screen === 'dying') return updateDying(s)
  if (s.screen === 'waveClear') return updateWaveClear(s)
  if (s.screen !== 'playing') return

  s.frameNo++
  if (s.isReplay) applyReplayInput(s)

  // One alive-list per frame, shared by every phase that needs it.
  const alive = s.invaders.filter((inv) => inv.alive)

  updatePlayer(s)
  updatePlayerBullet(s)
  updateInvaders(s, alive)
  updateInvaderShooting(s, alive)
  moveInvaderBullets(s)
  updatePowerUp(s)
  checkBulletClash(s)
  checkPlayerBulletCollisions(s)
  awardExtraLife(s)
  if (checkInvadersReachBottom(s, alive)) return
  updateUfo(s)
  checkWaveClear(s)
}

export function updateDying(s: GameState): void {
  s.dyingTimer--
  if (s.dyingTimer > 0) return
  if (s.lives <= 0) {
    endGame(s)
    return
  }
  s.player.x = VW / 2 - PLAYER_W / 2
  s.player.invincible = RESPAWN_INVINCIBLE_FRAMES
  s.input = { left: false, right: false, shoot: false }
  s.screen = 'playing'
}

export function updateWaveClear(s: GameState): void {
  s.waveClearTimer--
  if (s.waveClearTimer > 0) return
  s.wave++
  startWave(s)
  s.screen = 'playing'
}

/** Lay out a fresh grid for `s.wave`, tuned from the WAVES table. */
export function startWave(s: GameState): void {
  const t = waveTuning(s.wave)
  s.invaders = createInvaders(t.descent)
  s.invaderDir = 1
  s.invaderBullets = []
  s.player.bullet = null
  s.player.spread = []
  s.powerUp = null
  s.ufo = null
  s.ufoTimer = 0
  s.invaderFrame = 0
  s.invaderMoveTimer = 0
  s.invaderMoveInterval = t.march
  s.invaderShootChance = t.fire
}

export function updatePlayer(s: GameState): void {
  if (s.input.left) s.player.x -= s.player.speed
  if (s.input.right) s.player.x += s.player.speed
  s.player.x = Math.max(5, Math.min(VW - s.player.w - 5, s.player.x))

  if (s.player.invincible > 0) s.player.invincible--
  if (s.player.rapid > 0) s.player.rapid--
  if (s.player.triple > 0) s.player.triple--

  if (s.input.shoot && !s.player.bullet) {
    const shot = (vx?: number): Bullet => ({
      x: s.player.x + s.player.w / 2 - BULLET_W / 2,
      y: s.player.y - 4,
      w: BULLET_W,
      h: BULLET_H,
      color: '#ffe600',
      ...(vx ? { vx } : {}),
    })
    s.player.bullet = shot()
    if (s.player.triple > 0) s.player.spread.push(shot(-SPREAD_VX), shot(SPREAD_VX))
  }
}

/** Rapid fire is a faster bullet: the cannon still has one shot in the air,
 *  it just comes back sooner — the original's one-shot rule stays intact. */
export function updatePlayerBullet(s: GameState): void {
  const speed = BULLET_SPEED * (s.player.rapid > 0 ? RAPID_SPEED : 1)
  for (let i = s.player.spread.length - 1; i >= 0; i--) {
    const b = s.player.spread[i]
    b.x += b.vx ?? 0
    b.y -= speed
    if (b.y < -10 || b.x < -10 || b.x > VW + 10) s.player.spread.splice(i, 1)
  }
  if (!s.player.bullet) return
  s.player.bullet.y -= speed
  if (s.player.bullet.y < -10) s.player.bullet = null
}

/** The capsule falls; the cannon catches it, the ground swallows it. */
export function updatePowerUp(s: GameState): void {
  const p = s.powerUp
  if (!p) return
  p.y += POWER_FALL
  if (rectsOverlap({ x: p.x, y: p.y, w: POWER_W, h: POWER_H }, s.player)) {
    s.powerUp = null
    if (p.kind === 'rapid') s.player.rapid = POWER_FRAMES
    else if (p.kind === 'triple') s.player.triple = POWER_FRAMES
    else if (p.kind === 'shield') s.player.shield = true
    else s.lives = Math.min(MAX_LIVES, s.lives + 1)
  } else if (p.y > VH) s.powerUp = null
}

function maybeDropPower(s: GameState, x: number, y: number): void {
  // Rolled on every kill, capsule or not, so the RNG stream — and the replay
  // tape — never depends on whether one happened to be falling.
  const roll = nextRandom(s)
  const pick = nextRandom(s)
  if (s.powerUp || roll >= POWER_CHANCE) return
  const kind = POWER_TABLE.find(([p]) => pick < p)![1]
  s.powerUp = { x: x + INVADER_W / 2 - POWER_W / 2, y, kind }
}

/** Frames between invader steps: the wave's base cadence, quickening as the
 *  grid thins (the arcade's signature acceleration), then the last two sprint. */
export function moveCadence(base: number, alive: number): number {
  if (alive <= 1) return 1
  if (alive <= 2) return 2
  return Math.max(3, Math.round(base * alive / TOTAL_INVADERS))
}

/** Px the grid moves per step with `alive` invaders left. */
export function strideFor(s: GameState, alive: number): number {
  const { sprint } = waveTuning(s.wave)
  if (alive === 1) return sprint * FINAL_BOOST
  const ramp = BASE_STRIDE + Math.max(0, (TOTAL_INVADERS - alive) * STRIDE_RAMP)
  return Math.min(ramp, sprint * moveCadence(s.invaderMoveInterval, alive))
}

export function updateInvaders(s: GameState, alive: GameState['invaders']): void {
  s.invaderMoveTimer++
  if (s.invaderMoveTimer < moveCadence(s.invaderMoveInterval, alive.length)) return
  s.invaderMoveTimer = 0
  s.invaderFrame = 1 - s.invaderFrame

  // The fewer are left, the further each one strides — the classic ramp.
  // Named `stride`, not `step`: this module exports a function called step().
  // Capped at the wave's sprint speed (px per frame): the last invaders are
  // frantic, never a blur — except the very last, which bolts at FINAL_BOOST.
  const stride = strideFor(s, alive.length)
  for (const inv of alive) inv.x += stride * s.invaderDir

  const edgeHit = alive.some((inv) => inv.x + INVADER_W > VW - 10 || inv.x < 10)
  if (edgeHit) {
    s.invaderDir *= -1
    for (const inv of alive) inv.y += INVADER_DROP
  }
}

export function updateInvaderShooting(s: GameState, alive: GameState['invaders']): void {
  // Only the lowest invader in each column can shoot.
  const bottomInvaders = new Map<number, GameState['invaders'][number]>()
  for (const inv of alive) {
    const current = bottomInvaders.get(inv.col)
    if (!current || inv.row > current.row) bottomInvaders.set(inv.col, inv)
  }
  const { cap, aim } = waveTuning(s.wave)
  // Aimed fire: the shooter nearest the cannon is the likeliest to pull the trigger.
  const cx = s.player.x + s.player.w / 2
  let aimed: GameState['invaders'][number] | null = null
  for (const inv of bottomInvaders.values()) {
    if (!aimed || Math.abs(inv.x + INVADER_W / 2 - cx) < Math.abs(aimed.x + INVADER_W / 2 - cx)) aimed = inv
  }
  for (const inv of bottomInvaders.values()) {
    const chance = s.invaderShootChance * (inv === aimed ? aim : 1)
    // The roll happens even at the cap, so the RNG stream — and every replay
    // tape — stays independent of how many shots are in the air.
    if (nextRandom(s) < chance && s.invaderBullets.length < cap) {
      s.invaderBullets.push({
        x: inv.x + INVADER_BULLET_DX,
        y: inv.y + INVADER_BULLET_DY,
        w: INVADER_BULLET_W,
        h: INVADER_BULLET_H,
        color: inv.color,
      })
    }
  }
}

export function moveInvaderBullets(s: GameState): void {
  for (let i = s.invaderBullets.length - 1; i >= 0; i--) {
    const b = s.invaderBullets[i]
    b.y += waveTuning(s.wave).bomb
    if (b.y > VH + 10) {
      s.invaderBullets.splice(i, 1)
      continue
    }

    if (s.player.invincible <= 0 && s.screen !== 'dying' && rectsOverlap(b, s.player) && s.player.shield) {
      s.player.shield = false
      s.invaderBullets.splice(i, 1)
      continue
    }

    if (s.player.invincible <= 0 && s.screen !== 'dying' && rectsOverlap(b, s.player)) {
      // The cannon is dead for this frame. `s.screen !== 'dying'` guards against
      // a second bullet overlapping the cannon in the same frame draining a
      // second life (1 -> -1), which skipped the 'lives == 0' end-of-run path.
      s.lives--
      clearPowers(s)
      s.screen = 'dying'
      s.dyingTimer = DYING_FRAMES
      s.invaderBullets.splice(i, 1)
      continue
    }

    if (hitShields(s, b)) s.invaderBullets.splice(i, 1)
  }
}

/** Blast a hole in the first shield the bullet touches. True if it connected. */
function hitShields(s: GameState, b: { x: number; y: number; w: number; h: number }): boolean {
  for (const shield of s.shields) {
    for (const px of shield) {
      if (px.alive && rectsOverlap(b, px)) {
        px.alive = false
        destroyShieldArea(shield, px.x, px.y, 8)
        return true
      }
    }
  }
  return false
}

/** Shots that meet mid-air cancel out — the player's one defensive trick. */
export function checkBulletClash(s: GameState): void {
  const bullet = s.player.bullet
  if (!bullet) return
  const i = s.invaderBullets.findIndex((b) => rectsOverlap(bullet, b))
  if (i < 0) return
  s.invaderBullets.splice(i, 1)
  s.player.bullet = null
  s.score += BOMB_POINTS
}

export function awardExtraLife(s: GameState): void {
  if (s.extraLifeAwarded || s.score < EXTRA_LIFE_SCORE) return
  s.extraLifeAwarded = true
  s.lives = Math.min(MAX_LIVES, s.lives + 1)
}

export function checkPlayerBulletCollisions(s: GameState): void {
  if (s.player.bullet && shotHits(s, s.player.bullet)) s.player.bullet = null
  for (let i = s.player.spread.length - 1; i >= 0; i--) {
    if (shotHits(s, s.player.spread[i])) s.player.spread.splice(i, 1)
  }
}

/** Resolve one player shot against invaders, the UFO, then the shields.
 *  True if it hit something (and is spent). */
function shotHits(s: GameState, bullet: Bullet): boolean {
  for (const inv of s.invaders) {
    if (!inv.alive) continue
    if (rectsOverlap(bullet, { x: inv.x, y: inv.y, w: INVADER_W, h: INVADER_H })) {
      inv.alive = false
      s.score += inv.points
      maybeDropPower(s, inv.x, inv.y)
      return true
    }
  }

  if (s.ufo && rectsOverlap(bullet, { x: s.ufo.x, y: s.ufo.y, w: UFO_W, h: UFO_H })) {
    s.score += UFO_POINTS[Math.floor(nextRandom(s) * UFO_POINTS.length)]
    s.ufo = null
    s.ufoHits++
    return true
  }

  for (const shield of s.shields) {
    for (const px of shield) {
      if (px.alive && rectsOverlap(bullet, px)) {
        px.alive = false
        return true
      }
    }
  }
  return false
}

/** True if the invasion succeeded and the game is over. */
export function checkInvadersReachBottom(s: GameState, alive: GameState['invaders']): boolean {
  // `alive` is the frame-start list; an invader shot earlier this frame must not
  // still land on the player, so re-check the flag.
  if (alive.some((inv) => inv.alive && inv.y + INVADER_SPRITE_H >= s.player.y)) {
    endGame(s)
    return true
  }

  // Invaders grinding over a shield erase the pixels they touch.
  for (const inv of alive) {
    if (!inv.alive) continue
    const box = { x: inv.x, y: inv.y, w: INVADER_W, h: INVADER_H }
    for (const shield of s.shields) {
      for (const px of shield) {
        if (px.alive && rectsOverlap(box, px)) px.alive = false
      }
    }
  }
  return false
}

export function updateUfo(s: GameState): void {
  s.ufoTimer++
  if (!s.ufo && s.ufoTimer > UFO_INTERVAL) {
    s.ufoTimer = 0
    const goRight = nextRandom(s) > 0.5
    s.ufo = { x: goRight ? -UFO_MARGIN : VW + UFO_MARGIN, y: UFO_LANE_Y, dir: goRight ? 1 : -1 }
  }
  if (s.ufo) {
    s.ufo.x += s.ufo.dir * UFO_SPEED
    if (s.ufo.x < -60 || s.ufo.x > VW + 60) s.ufo = null
  }
}

export function checkWaveClear(s: GameState): void {
  if (s.invaders.every((i) => !i.alive)) {
    s.score += WAVE_BONUS * s.wave
    s.screen = 'waveClear'
    s.waveClearTimer = WAVE_CLEAR_FRAMES
  }
}
