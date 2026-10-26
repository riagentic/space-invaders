import { assert, assertEquals } from '@std/assert'
import { type TestUI, testUI } from 'aio/testing'
// testUI docs: dep/aio/docs/testing/ui-testing.md
import App from '../src/App.tsx'
import { game } from '../src/features/game/index.ts'
import { scores } from '../src/features/scores/index.ts'

// Real UI tests: every interaction below goes through the DOM the way a player
// drives it — `press`/`keyDown`/`keyUp` dispatch bubbling KeyboardEvents that
// reach the window listeners App installs (dep/aio/src/air/ui-trigger.ts:51).
// Held keys use keyDown/keyUp; ticks are driven by hand because the harness has
// no requestAnimationFrame.
//
// `game` is a scope:'client' cell, so `ui.expectCell` cannot observe it (it is
// never registered with the server store). `ui.settle()` plus a direct read is
// the equivalent, and is what the assertions use.

/** Any always-rendered element works as the key target — the event bubbles. */
const KEYS = 'hud-score'

/** Drive a real game to its end, the way the RAF loop would. */
function playToTheEnd(): 'gameOver' | 'nameEntry' {
  for (let i = 0; i < 200_000; i++) {
    const screen = game.screen
    if (screen === 'gameOver' || screen === 'nameEntry') return screen
    game.tick()
  }
  throw new Error('the game never ended')
}

testUI(App, 'the title screen is what a player sees on boot', async (ui: TestUI) => {
  await ui.settle()
  const html = ui.html()
  assert(html.includes('SPACE INVADERS'), 'title missing')
  assert(html.includes('PRESS ENTER OR SPACE TO START'), 'start prompt missing')
  assertEquals(game.screen, 'title')
})

testUI(App, 'pressing Enter on the title starts the game and shows the HUD', async (ui: TestUI) => {
  await ui.settle()
  ui[KEYS].press('Enter')
  await ui.settle()

  assertEquals(game.screen, 'playing')
  assertEquals(game.invaders.length, 55)
  const html = ui.html()
  assert(html.includes('SCORE'), 'HUD score missing')
  assert(html.includes('WAVE'), 'wave badge missing')
  assert(html.includes('HI-SCORE'), 'hi-score missing')
})

testUI(App, 'Space also starts the game', async (ui: TestUI) => {
  await ui.settle()
  ui[KEYS].press(' ')
  await ui.settle()
  assertEquals(game.screen, 'playing')
})

testUI(App, 'P pauses and resumes, and the overlay follows', async (ui: TestUI) => {
  await ui.settle()
  ui[KEYS].press('Enter')
  await ui.settle()

  ui[KEYS].press('p')
  await ui.settle()
  assertEquals(game.screen, 'paused')
  assert(ui.html().includes('PRESS P TO RESUME'), 'pause overlay missing')

  ui[KEYS].press('p')
  await ui.settle()
  assertEquals(game.screen, 'playing')
})

testUI(App, 'holding a movement key moves the cannon, releasing stops it', async (ui: TestUI) => {
  await ui.settle()
  ui[KEYS].press('Enter')
  await ui.settle()

  // A real hold: keyDown, advance frames, keyUp — the interaction a tap-only
  // `press` could not express.
  const startX = game.player.x
  ui[KEYS].keyDown('ArrowLeft')
  await ui.settle()
  assertEquals(game.input.left, true, 'the key is held down')

  for (let i = 0; i < 10; i++) game.tick()
  const movedX = game.player.x
  assert(movedX < startX, 'the cannon moved left while held')

  ui[KEYS].keyUp('ArrowLeft')
  await ui.settle()
  assertEquals(game.input.left, false, 'the key was released')

  for (let i = 0; i < 10; i++) game.tick()
  assertEquals(game.player.x, movedX, 'and the cannon stopped')

  const events = game.tape.events
  assertEquals(events.length, 2, 'one press and one release were recorded')
  assertEquals(events.map((e) => e.down), [true, false])
})

testUI(App, 'a finished game offers name entry, records the score, and replays', async (ui: TestUI) => {
  await ui.settle()
  ui[KEYS].press('Enter')
  await ui.settle()

  // Hold fire so the run actually scores — a real held key, through the DOM.
  ui[KEYS].keyDown(' ')
  await ui.settle()
  const ended = playToTheEnd()
  await ui.settle()
  assertEquals(ended, 'nameEntry', 'a positive score on an empty board qualifies')
  assert(game.score > 0)

  let html = ui.html()
  assert(html.includes('HIGH SCORE!'), 'name entry header missing')
  assert(html.includes('TYPE 4 CHARS'), 'name entry prompt missing')

  // Type the initials through the keyboard.
  for (const ch of ['a', 'c', 'e', '7']) ui[KEYS].press(ch)
  await ui.settle()
  assertEquals(game.nameEntry, 'ACE7', 'typed initials are upper-cased')

  const finalScore = game.score
  ui[KEYS].press('Enter')
  await ui.settle()

  assertEquals(game.screen, 'gameOver')
  assertEquals(scores.entries[0].name, 'ACE7')
  assertEquals(scores.entries[0].score, finalScore)
  assertEquals(scores.hiScore, finalScore)

  html = ui.html()
  assert(html.includes('GAME OVER'), 'game over overlay missing')
  assert(html.includes('ACE7'), 'the new leaderboard row is rendered')
  assert(html.includes('PRESS ENTER TO TRY AGAIN'), 'restart prompt missing')
  assert(html.includes('REPLAY LAST GAME'), 'replay button missing')

  // The replay button is live now that a game has finished.
  ui.replay.click()
  await ui.settle()
  assertEquals(game.isReplay, true, 'the replay started')
  assertEquals(game.screen, 'playing')
  assertEquals(game.rngSeed, game.lastReplay!.seed, 'replay re-seeds from the tape')
})

testUI(App, 'the R hotkey replays the last game, like the button', async (ui: TestUI) => {
  await ui.settle()
  ui[KEYS].press('Enter')
  await ui.settle()
  // settle first: UI actions are queued, and playToTheEnd() drives ticks
  // synchronously — without this the key is still un-pressed when the run starts.
  ui[KEYS].keyDown(' ')
  await ui.settle()
  playToTheEnd()
  await ui.settle()
  ui[KEYS].press('Enter') // clear name entry if it was offered
  await ui.settle()
  assertEquals(game.screen, 'gameOver')

  const tape = game.lastReplay!
  ui[KEYS].press('r')
  await ui.settle()
  assertEquals(game.isReplay, true, 'R started the replay')
  assertEquals(game.rngSeed, tape.seed)
  assertEquals(game.screen, 'playing')
})

testUI(App, 'Enter on the game over screen starts a fresh run', async (ui: TestUI) => {
  await ui.settle()
  ui[KEYS].press('Enter')
  await ui.settle()
  // No shots fired this run, so the score stays 0 and cannot qualify — the
  // end screen is deterministic.
  const ended = playToTheEnd()
  await ui.settle()
  assertEquals(game.score, 0)
  assertEquals(ended, 'gameOver')

  ui[KEYS].press('Enter')
  await ui.settle()
  assertEquals(game.screen, 'playing')
  assertEquals(game.score, 0)
  assertEquals(game.lives, 3)
})

testUI(App, 'Esc abandons the run and returns to the main menu', async (ui: TestUI) => {
  await ui.settle()
  ui[KEYS].press('Enter')
  await ui.settle()
  assertEquals(game.screen, 'playing')

  ui[KEYS].keyDown(' ')
  await ui.settle()
  for (let i = 0; i < 500; i++) game.tick()
  assert(game.score > 0, 'the run scored something')

  ui[KEYS].press('Escape')
  await ui.settle()

  assertEquals(game.screen, 'title')
  assertEquals(game.score, 0, 'a quit forfeits the score')
  const html = ui.html()
  assert(html.includes('PRESS ENTER OR SPACE TO START'), 'the main menu is showing')

  // …and the menu is live: Enter starts a fresh run.
  ui[KEYS].press('Enter')
  await ui.settle()
  assertEquals(game.screen, 'playing')
  assertEquals(game.lives, 3)
})

testUI(App, 'Esc also escapes a paused game', async (ui: TestUI) => {
  await ui.settle()
  ui[KEYS].press('Enter')
  await ui.settle()
  ui[KEYS].press('p')
  await ui.settle()
  assertEquals(game.screen, 'paused')

  ui[KEYS].press('Escape')
  await ui.settle()
  assertEquals(game.screen, 'title')
})

testUI(App, 'the FPS readout is rendered in the play area', async (ui: TestUI) => {
  await ui.settle()
  // The rAF loop never runs under the harness, so the meter reads 0 — what is
  // asserted here is that the readout exists and is wired to the signal.
  assertEquals(ui.fps.text.trim(), '0 FPS')
  assert(ui.html().includes('id="fps"'), 'the readout is in the DOM')
})

testUI(App, 'the controls hint advertises Esc', async (ui: TestUI) => {
  await ui.settle()
  const html = ui.html()
  assert(html.includes('MENU'), 'the title screen tells the player about Esc')
})

testUI(App, 'the title screen credits the framework', async (ui: TestUI) => {
  await ui.settle()
  assertEquals(ui.credit.text.trim(), 'USING AIO FRAMEWORK © RIAGENTIC 2026')
})
