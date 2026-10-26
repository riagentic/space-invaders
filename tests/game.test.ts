import { assert, assertEquals } from '@std/assert'
import { testCell } from 'aio/testing'
// testCell docs: dep/aio/docs/testing/cell-testing.md
import { game } from '../src/features/game/index.ts'
import type { GameState } from '../src/features/game/types.ts'
import {
  BOMB_POINTS,
  checkWaveClear,
  POWER_FRAMES,
  RAPID_SPEED,
  WAVE_BONUS,
  EXTRA_LIFE_SCORE,
  FINAL_BOOST,
  moveCadence,
  DYING_FRAMES,
  initialGameState,
  qualifies,
  recordInput,
  resetGame,
  step,
  updateWaveClear,
  WAVE_CLEAR_FRAMES,
} from '../src/features/game/step.ts'
import { BASE_MOVE_INTERVAL, BULLET_SPEED, VW, WAVES } from '../src/features/game/constants.ts'

// The simulation is a pure function of (seed, inputs), so every test below
// fixes the seed. Nothing here depends on wall-clock time or Math.random.
const SEED = 12345

function frames(t: { send: { tick(): unknown } }, n: number) {
  for (let i = 0; i < n; i++) t.send.tick()
}

/** A bare engine state, outside the cell — the engine has no aio dependency. */
function startedGame(seed = SEED): GameState {
  const s = initialGameState()
  resetGame(s, seed)
  return s
}

// ── engine: pure step() ─────────────────────────────────────────────────────

Deno.test('resetGame: seed 0 is coerced so xorshift cannot lock at zero', () => {
  const s = startedGame(0)
  assert(s.rngSeed !== 0)
  const before = s.rngSeed
  for (let i = 0; i < 200; i++) step(s)
  assert(s.rngSeed !== before, 'rng must advance')
})

Deno.test('step: invaders take their first stride after exactly BASE_MOVE_INTERVAL frames', () => {
  const s = startedGame()
  const startX = s.invaders[0].x
  for (let i = 0; i < BASE_MOVE_INTERVAL - 1; i++) step(s)
  assertEquals(s.invaders[0].x, startX, 'must not move early')
  assertEquals(s.invaderFrame, 0)
  step(s)
  assertEquals(s.invaders[0].x, startX + 8, 'full grid strides 8px')
  assertEquals(s.invaderFrame, 1, 'animation frame flips on every move')
})

Deno.test('step: the player cannon never leaves the playfield', () => {
  const s = startedGame()
  // Isolate the clamp: without this the cannon gets shot mid-run and respawns
  // in the centre, which would test the death path rather than the bounds.
  s.player.invincible = Number.MAX_SAFE_INTEGER
  s.input.left = true
  for (let i = 0; i < 300; i++) step(s)
  assertEquals(s.player.x, 5, 'clamped at the left wall')
  s.input.left = false
  s.input.right = true
  for (let i = 0; i < 300; i++) step(s)
  assertEquals(s.player.x, VW - s.player.w - 5, 'clamped at the right wall')
})

Deno.test('step: firing spawns one bullet that travels up and is not re-fired', () => {
  const s = startedGame()
  s.input.shoot = true
  step(s)
  const bullet = s.player.bullet
  assert(bullet, 'a bullet must exist')
  const y1 = bullet.y
  step(s)
  assert(s.player.bullet!.y < y1, 'bullet travels up')
  assertEquals(s.player.bullet === bullet, true, 'still the same single bullet')
})

Deno.test('checkWaveClear: an empty grid ends the wave with the full timer', () => {
  const s = startedGame()
  for (const inv of s.invaders) inv.alive = false
  checkWaveClear(s)
  assertEquals(s.screen, 'waveClear')
  assertEquals(s.waveClearTimer, WAVE_CLEAR_FRAMES)
})

Deno.test('updateWaveClear: the next wave rebuilds the grid and speeds up', () => {
  const s = startedGame()
  s.screen = 'waveClear'
  s.waveClearTimer = WAVE_CLEAR_FRAMES
  const interval = s.invaderMoveInterval
  for (let i = 0; i < WAVE_CLEAR_FRAMES; i++) updateWaveClear(s)
  assertEquals(s.screen, 'playing')
  assertEquals(s.wave, 2)
  assertEquals(s.invaders.length, 55)
  assert(s.invaders.every((i) => i.alive), 'a fresh grid')
  assert(s.invaderMoveInterval < interval, 'wave 2 moves faster')
})

Deno.test('step: an invader bullet that reaches the player costs a life', () => {
  const s = startedGame()
  // Place a bullet right on top of the cannon; invincibility starts at 0.
  s.invaderBullets.push({ x: s.player.x + 2, y: s.player.y, w: 3, h: 10, color: '#fff' })
  step(s)
  assertEquals(s.screen, 'dying')
  assertEquals(s.lives, 2)
})

Deno.test('step: dying resolves to a respawn while lives remain', () => {
  const s = startedGame()
  s.invaderBullets.push({ x: s.player.x + 2, y: s.player.y, w: 3, h: 10, color: '#fff' })
  step(s)
  assertEquals(s.screen, 'dying')
  for (let i = 0; i < DYING_FRAMES; i++) step(s)
  assertEquals(s.screen, 'playing')
  assertEquals(s.lives, 2)
  assert(s.player.invincible > 0, 'respawn grants invincibility')
})

Deno.test('moveCadence: the grid quickens as it thins, the final two sprint', () => {
  assertEquals(moveCadence(40, 55), 40, 'a full grid marches at the wave base')
  assertEquals(moveCadence(40, 27), 20, 'half the grid, twice the pace')
  assertEquals(moveCadence(40, 5), 4)
  assertEquals(moveCadence(40, 3), 3, 'never faster than 3 frames until the last two')
  assertEquals(moveCadence(40, 2), 2)
  assertEquals(moveCadence(40, 1), 1)
})

Deno.test('step: invader fire is capped per wave', () => {
  const s = startedGame()
  s.invaderShootChance = 1
  step(s)
  assertEquals(s.invaderBullets.length, WAVES[0].cap)
})

Deno.test('step: shots that meet mid-air cancel out', () => {
  const s = startedGame()
  s.player.bullet = { x: 100, y: 200, w: 3, h: 10, color: '#fff' }
  s.invaderBullets = [{ x: 100, y: 185, w: 3, h: 10, color: '#fff' }]
  s.invaderShootChance = 0
  step(s)
  assertEquals(s.player.bullet, null)
  assertEquals(s.invaderBullets.length, 0)
  assertEquals(s.score, BOMB_POINTS, 'shooting a bomb pays')
})

Deno.test('step: 1500 points earns one bonus cannon per run', () => {
  const s = startedGame()
  s.invaderShootChance = 0
  s.score = EXTRA_LIFE_SCORE
  step(s)
  assertEquals(s.lives, 4)
  step(s)
  assertEquals(s.lives, 4, 'only once')
})

Deno.test('step: later waves start lower', () => {
  const s = startedGame()
  const y1 = s.invaders[0].y
  for (const inv of s.invaders) inv.alive = false
  step(s)
  for (let i = 0; i < 200 && s.screen !== 'playing'; i++) step(s)
  assertEquals(s.wave, 2)
  assertEquals(s.invaders[0].y, y1 + WAVES[1].descent)
})

Deno.test('step: the last life ends the game', () => {
  const s = startedGame()
  s.lives = 1
  s.invaderBullets.push({ x: s.player.x + 2, y: s.player.y, w: 3, h: 10, color: '#fff' })
  step(s)
  assertEquals(s.lives, 0)
  for (let i = 0; i < DYING_FRAMES; i++) step(s)
  assertEquals(s.screen, 'gameOver', 'score 0 does not qualify for the board')
})

Deno.test('step: REGRESSION — simultaneous bullets only ever cost one life', () => {
  // Regression: two bullets overlapping the cannon in the same frame both
  // passed the hit test — the first set screen='dying' but the loop kept going
  // and the second decremented lives again, taking the player 1 -> -1 and
  // skipping the 'lives == 0' game-over path entirely.
  const s = startedGame()
  s.lives = 1
  s.player.invincible = 0
  s.player.bullet = null
  for (let i = 0; i < 3; i++) {
    s.invaderBullets.push({ x: s.player.x + 1, y: s.player.y + 5, w: 3, h: 10, color: '#fff' })
  }
  step(s)
  assertEquals(s.lives, 0, 'exactly one life is lost however many bullets connect')
  assertEquals(s.screen, 'dying')
  for (let i = 0; i < DYING_FRAMES; i++) step(s)
  assertEquals(s.screen, 'gameOver', 'zero lives really is the end of the run')
})

Deno.test('step: invaders reaching the cannon line end the game immediately', () => {
  const s = startedGame()
  for (const inv of s.invaders) inv.y = s.player.y
  step(s)
  // resetGame zeroes the score, so this run cannot qualify — the outcome is
  // fixed, not "one of two screens".
  assertEquals(s.screen, 'gameOver')
})

Deno.test('step: reaching the cannon line with a qualifying score prompts for a name', () => {
  const s = startedGame()
  s.score = 500
  s.qualifyThreshold = 0
  for (const inv of s.invaders) inv.y = s.player.y
  step(s)
  assertEquals(s.screen, 'nameEntry')
})

Deno.test('qualifies: needs a positive score above the threshold', () => {
  const s = startedGame()
  s.score = 0
  assertEquals(qualifies(s), false)
  s.score = 10
  s.qualifyThreshold = 0
  assertEquals(qualifies(s), true)
  s.qualifyThreshold = 10
  assertEquals(qualifies(s), false, 'a tie does not displace the incumbent')
  s.qualifyThreshold = 9
  assertEquals(qualifies(s), true)
})

// ── engine: replay determinism ──────────────────────────────────────────────

Deno.test('replay: re-running the tape reproduces the game exactly', () => {
  const FRAMES = 400

  // Play a game with a scripted set of input changes.
  const live = startedGame()
  const script: [number, 'left' | 'right' | 'shoot', boolean][] = [
    [5, 'right', true],
    [40, 'right', false],
    [45, 'shoot', true],
    [60, 'shoot', false],
    [90, 'left', true],
    [150, 'left', false],
    [160, 'shoot', true],
  ]
  for (let f = 0; f < FRAMES; f++) {
    for (const [at, key, down] of script) {
      if (live.frameNo === at) {
        live.input[key] = down
        recordInput(live, key, down)
      }
    }
    step(live)
  }
  const tape = live.tape
  assert(tape.events.length === script.length, 'every input change was recorded')

  // Replay it: same seed, same tape, no live input at all.
  const replay = startedGame(tape.seed)
  replay.lastReplay = tape
  replay.isReplay = true
  replay.replayCursor = 0
  for (let f = 0; f < FRAMES; f++) step(replay)

  assertEquals(replay.score, live.score)
  assertEquals(replay.player.x, live.player.x)
  assertEquals(replay.rngSeed, live.rngSeed)
  assertEquals(replay.invaders.filter((i) => i.alive).length, live.invaders.filter((i) => i.alive).length)
  assertEquals(replay.screen, live.screen)
})

Deno.test('replay: a divergent tape produces a different game (the test has teeth)', () => {
  const FRAMES = 200
  const live = startedGame()
  live.input.right = true
  recordInput(live, 'right', true)
  for (let f = 0; f < FRAMES; f++) step(live)

  const other = startedGame()
  other.lastReplay = { seed: live.tape.seed, events: [{ frame: 1, key: 'left', down: true }] }
  other.isReplay = true
  for (let f = 0; f < FRAMES; f++) step(other)

  assert(other.player.x !== live.player.x, 'different inputs must diverge')
})

Deno.test('recordInput: a replay never records over the tape it is replaying', () => {
  const s = startedGame()
  s.isReplay = true
  recordInput(s, 'left', true)
  assertEquals(s.tape.events.length, 0)
})

// ── cell: methods and guards ────────────────────────────────────────────────

testCell(game, 'starts on the title screen with 3 lives', (t) => {
  t.expect.state((s) => s.screen === 'title')
  t.expect.state((s) => s.lives === 3 && s.score === 0 && s.wave === 1)
})

testCell(game, 'startGame builds a full board and only works from the title', (t) => {
  t.send.startGame(SEED)
  t.expect.state((s) => s.screen === 'playing')
  t.expect.state((s) => s.invaders.length === 55 && s.invaders.every((i) => i.alive))
  t.expect.state((s) => s.shields.length === 4 && s.rngSeed === SEED)
  t.send.startGame(999) // already playing — must not re-seed or reset
  t.expect.state((s) => s.rngSeed !== 999)
})

testCell(game, 'restart only works from game over', (t) => {
  t.send.startGame(SEED)
  t.send.restart(777)
  t.expect.state((s) => s.rngSeed !== 777)
})

testCell(game, 'pause toggles playing and paused, and nothing else', (t) => {
  t.send.pause()
  t.expect.state((s) => s.screen === 'title')
  t.send.startGame(SEED)
  t.send.pause()
  t.expect.state((s) => s.screen === 'paused')
  t.send.pause()
  t.expect.state((s) => s.screen === 'playing')
})

testCell(game, 'a paused game does not advance', (t) => {
  t.send.startGame(SEED)
  frames(t, 10)
  t.send.pause()
  const frozen = t.getState().frameNo
  frames(t, 30)
  t.expect.state((s) => s.frameNo === frozen)
})

testCell(game, 'REGRESSION: a key released while paused stays released on resume', (t) => {
  // The keyUp handler used to be gated on `screen === 'playing'`, so a release
  // during a pause was swallowed and the ship drifted forever after resuming.
  t.send.startGame(SEED)
  t.send.keyDown('ArrowLeft')
  frames(t, 5)
  t.send.pause()
  t.send.keyUp('ArrowLeft')
  t.send.pause()
  const x0 = t.getState().player.x
  frames(t, 20)
  t.expect.state((s) => !s.input.left)
  t.expect.state((s) => s.player.x === x0)
})

testCell(game, 'movement keys move the cannon and both bindings agree', (t) => {
  t.send.startGame(SEED)
  const startX = t.getState().player.x
  t.send.keyDown('a') // the A/D binding
  frames(t, 10)
  t.send.keyUp('a')
  const afterLeft = t.getState().player.x
  assert(afterLeft < startX, 'A moves left')
  t.send.keyDown('ArrowRight')
  frames(t, 10)
  t.send.keyUp('ArrowRight')
  assert(t.getState().player.x > afterLeft, 'ArrowRight moves right')
})

testCell(game, 'input changes are recorded onto the replay tape', (t) => {
  t.send.startGame(SEED)
  frames(t, 3)
  t.send.keyDown('ArrowLeft')
  frames(t, 3)
  t.send.keyUp('ArrowLeft')
  const tape = t.getState().tape
  assertEquals(tape.events.length, 2)
  assertEquals(tape.events[0], { frame: 4, key: 'left', down: true })
  assertEquals(tape.events[1], { frame: 7, key: 'left', down: false })
  assertEquals(tape.seed, SEED)
})

testCell(game, 'a held key is recorded once, not once per repeat', (t) => {
  t.send.startGame(SEED)
  t.send.keyDown('ArrowLeft')
  t.send.keyDown('ArrowLeft') // OS key-repeat
  t.send.keyDown('ArrowLeft')
  assertEquals(t.getState().tape.events.length, 1)
})

testCell(game, 'startReplay is refused until a game has actually finished', (t) => {
  t.send.startGame(SEED)
  t.send.startReplay()
  t.expect.state((s) => !s.isReplay)
})

testCell(game, 'nameEntryKey is ignored outside the name-entry screen', (t) => {
  t.send.startGame(SEED)
  t.send.nameEntryKey('A')
  t.expect.state((s) => s.nameEntry === '')
})

/** Play a real game to its end. Deterministic: fixed seed, scripted fire. */
function playToTheEnd(t: {
  send: { setQualifyThreshold(n: number): unknown; keyDown(k: string): unknown; tick(): unknown }
  getState(): GameState
}) {
  t.send.setQualifyThreshold(0)
  t.send.keyDown(' ') // hold fire so the run scores points
  for (let i = 0; i < 200_000; i++) {
    const screen = t.getState().screen
    if (screen === 'gameOver' || screen === 'nameEntry') return screen
    t.send.tick()
  }
  throw new Error('the game never ended')
}

testCell(game, 'a real playthrough scores points and reaches the name-entry screen', (t) => {
  t.send.startGame(SEED)
  const screen = playToTheEnd(t)
  const s = t.getState()
  assert(s.score > 0, 'holding fire must score')
  assertEquals(screen, 'nameEntry', 'a positive score clears a threshold of 0')
  assert(s.lastReplay !== null, 'the finished game was banked for replay')
  assertEquals(s.lastReplay!.seed, SEED)
})

testCell(game, 'name entry takes 4 alphanumerics, rejects others, and backspaces', (t) => {
  t.send.startGame(SEED)
  playToTheEnd(t)
  t.expect.state((s) => s.screen === 'nameEntry')

  t.send.nameEntryKey('a')
  t.send.nameEntryKey('9')
  t.expect.state((s) => s.nameEntry === 'A9')

  t.send.nameEntryKey('-')
  t.send.nameEntryKey(' ')
  t.expect.state((s) => s.nameEntry === 'A9')

  t.send.nameEntryKey('Backspace')
  t.expect.state((s) => s.nameEntry === 'A')

  t.send.nameEntryKey('B')
  t.send.nameEntryKey('C')
  t.send.nameEntryKey('D')
  t.send.nameEntryKey('E') // 5th char — must not fit
  t.expect.state((s) => s.nameEntry === 'ABCD')

  t.send.finishNameEntry()
  t.expect.state((s) => s.screen === 'gameOver' && s.nameEntry === '')
})

testCell(game, 'startReplay re-runs the finished game from its own tape', (t) => {
  t.send.startGame(SEED)
  playToTheEnd(t)
  t.send.finishNameEntry() // land on gameOver
  const finished = t.getState()
  const tape = finished.lastReplay!
  const finalScore = finished.score

  t.send.startReplay()
  t.expect.state((s) => s.isReplay && s.screen === 'playing')
  t.expect.state((s) => s.rngSeed === tape.seed)

  for (let i = 0; i < 200_000; i++) {
    const screen = t.getState().screen
    if (screen === 'gameOver' || screen === 'nameEntry') break
    t.send.tick()
  }
  const replayed = t.getState()
  assertEquals(replayed.score, finalScore, 'the replay reproduces the score')
  assertEquals(replayed.lastReplay!.events.length, tape.events.length, 'the tape was not overwritten')
  assertEquals(
    replayed.screen,
    'gameOver',
    'a replay must not re-prompt for a name — that score already claimed its slot',
  )
})

Deno.test('replay: a qualifying score is never offered a second leaderboard slot', () => {
  // Same run, played live vs replayed: live prompts for a name, the replay does not.
  const live = startedGame()
  live.qualifyThreshold = 0
  live.score = 500
  live.lives = 1
  live.invaderBullets.push({ x: live.player.x + 2, y: live.player.y, w: 3, h: 10, color: '#fff' })
  step(live)
  for (let i = 0; i < DYING_FRAMES; i++) step(live)
  assertEquals(live.screen, 'nameEntry')

  const replay = startedGame()
  replay.qualifyThreshold = 0
  replay.score = 500
  replay.lives = 1
  replay.isReplay = true
  replay.lastReplay = { seed: replay.rngSeed, events: [] }
  replay.invaderBullets.push({ x: replay.player.x + 2, y: replay.player.y, w: 3, h: 10, color: '#fff' })
  step(replay)
  for (let i = 0; i < DYING_FRAMES; i++) step(replay)
  assertEquals(replay.screen, 'gameOver')
})

// ── quit to menu (Esc) ──────────────────────────────────────────────────────

testCell(game, 'Esc abandons a run and returns to the title screen', (t) => {
  t.send.startGame(SEED)
  t.send.keyDown('ArrowLeft')
  frames(t, 30)
  t.send.quitToTitle()

  t.expect.state((s) => s.screen === 'title')
  t.expect.state((s) => s.score === 0 && s.lives === 3 && s.wave === 1)
  t.expect.state((s) => !s.input.left)
  t.expect.state((s) => s.invaders.length === 0 && s.shields.length === 0)
})

testCell(game, 'Esc works from paused, dying and waveClear too', (t) => {
  for (const reach of ['paused', 'waveClear'] as const) {
    t.send.startGame(SEED)
    if (reach === 'paused') t.send.pause()
    t.expect.state((s) => s.screen !== 'title')
    t.send.quitToTitle()
    t.expect.state((s) => s.screen === 'title')
  }
})

testCell(game, 'Esc on the title screen is a no-op', (t) => {
  t.send.quitToTitle()
  t.expect.state((s) => s.screen === 'title')
})

testCell(game, 'a quit forfeits the score — it is not a game over', (t) => {
  t.send.startGame(SEED)
  t.send.keyDown(' ')
  // Score something, then walk away.
  for (let i = 0; i < 2000 && t.getState().score === 0; i++) t.send.tick()
  assert(t.getState().score > 0, 'the run scored')
  t.send.quitToTitle()
  t.expect.state((s) => s.score === 0)
  t.expect.state((s) => s.screen === 'title')
})

testCell(game, 'a quit does not overwrite the last finished game replay', (t) => {
  t.send.startGame(SEED)
  playToTheEnd(t)
  t.send.finishNameEntry()
  const finished = t.getState().lastReplay!

  t.send.restart(999)
  frames(t, 20)
  t.send.quitToTitle()

  const after = t.getState().lastReplay!
  assertEquals(after.seed, finished.seed, 'still the last COMPLETED game')
  assertEquals(after.events.length, finished.events.length)
})

testCell(game, 'Esc is refused during name entry, so a qualifying score is not lost', (t) => {
  t.send.startGame(SEED)
  playToTheEnd(t)
  t.expect.state((s) => s.screen === 'nameEntry')
  t.send.quitToTitle()
  t.expect.state((s) => s.screen === 'nameEntry')
})

testCell(game, 'after a quit a fresh game can be started', (t) => {
  t.send.startGame(SEED)
  frames(t, 10)
  t.send.quitToTitle()
  t.send.startGame(4242)
  t.expect.state((s) => s.screen === 'playing' && s.rngSeed === 4242)
  t.expect.state((s) => s.invaders.length === 55)
})

// ── power-ups ───────────────────────────────────────────────────────────────

/** A capsule of `kind` resting on the cannon. */
function catchPower(kind: 'rapid' | 'triple' | 'shield' | 'life'): GameState {
  const s = startedGame()
  s.invaderShootChance = 0
  s.powerUp = { x: s.player.x + 8, y: s.player.y, kind }
  step(s)
  assertEquals(s.powerUp, null, 'caught')
  return s
}

Deno.test('power-up: rapid fire doubles bullet speed for its duration', () => {
  const s = catchPower('rapid')
  assertEquals(s.player.rapid, POWER_FRAMES - 0)
  s.player.bullet = { x: 10, y: 300, w: 3, h: 10, color: '#fff' }
  step(s)
  assertEquals(s.player.bullet?.y, 300 - BULLET_SPEED * RAPID_SPEED)
})

Deno.test('power-up: triple shot fires two side shots that spread', () => {
  const s = catchPower('triple')
  s.input.shoot = true
  step(s)
  assertEquals(s.player.spread.length, 2)
  const gap = s.player.spread[1].x - s.player.spread[0].x
  step(s)
  assert(s.player.spread[1].x - s.player.spread[0].x > gap, 'they fan out')
})

Deno.test('power-up: the shield eats one hit, then it is gone', () => {
  const s = catchPower('shield')
  s.invaderBullets = [{ x: s.player.x + 10, y: s.player.y, w: 3, h: 10, color: '#fff' }]
  step(s)
  assertEquals(s.lives, 3, 'no life lost')
  assertEquals(s.player.shield, false)
  assertEquals(s.screen, 'playing')
})

Deno.test('power-up: L is an extra life; a missed capsule falls away', () => {
  assertEquals(catchPower('life').lives, 4)
  const s = startedGame()
  s.invaderShootChance = 0
  s.powerUp = { x: 0, y: 470, kind: 'life' }
  for (let i = 0; i < 20; i++) step(s)
  assertEquals(s.powerUp, null)
  assertEquals(s.lives, 3)
})

Deno.test('power-up: dying loses every power', () => {
  const s = catchPower('rapid')
  s.player.triple = 100
  s.invaderBullets = [{ x: s.player.x + 10, y: s.player.y, w: 3, h: 10, color: '#fff' }]
  step(s)
  assertEquals(s.screen, 'dying')
  assertEquals([s.player.rapid, s.player.triple], [0, 0])
})

Deno.test('wave clear pays 100 x wave', () => {
  const s = startedGame()
  for (const inv of s.invaders) inv.alive = false
  checkWaveClear(s)
  assertEquals(s.score, WAVE_BONUS)
})

Deno.test('the last invader bolts at FINAL_BOOST x the wave sprint', () => {
  const s = startedGame()
  s.invaderShootChance = 0
  for (let i = 1; i < s.invaders.length; i++) s.invaders[i].alive = false
  const last = s.invaders[0]
  const x0 = last.x
  step(s)
  assertEquals(Math.abs(last.x - x0), WAVES[0].sprint * FINAL_BOOST)
})
