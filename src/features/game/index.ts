import { cell } from 'aio'
import type { InputKey } from './types.ts'
import { abandonRun, initialGameState, qualifies, recordInput, resetGame, step } from './step.ts'

/** Keyboard bindings, shared by keyDown and keyUp so they can never drift. */
const KEY_BINDINGS: Record<string, InputKey> = {
  ArrowLeft: 'left',
  a: 'left',
  A: 'left',
  ArrowRight: 'right',
  d: 'right',
  D: 'right',
  ' ': 'shoot',
  ArrowUp: 'shoot',
}

export const NAME_LENGTH = 4

/** The arcade machine — one per browser tab.
 *
 *  `scope: 'client'` because this is per-tab state that ticks 60×/s: it never
 *  registers with the server store, never syncs and never persists
 *  (dep/aio/docs/state/cells.md#shared-vs-per-client-state). Running it
 *  server-authoritative meant every frame round-tripped and rebroadcast the
 *  whole board — aio's own pressure monitor flagged it at 126 broadcasts/sec
 *  against a 30/sec threshold. Anything that must outlive the tab (the
 *  leaderboard) lives in the `scores` cell instead.
 */
export const game = cell('game', {
  scope: 'client' as const,
  state: initialGameState(),

  methods: {
    /** `seed` is supplied by the caller so the simulation stays a pure function
     *  of (seed, inputs) — that is what makes the replay tape reproducible. */
    startGame(s, seed: number) {
      if (s.screen !== 'title') return
      resetGame(s, seed)
    },

    restart(s, seed: number) {
      if (s.screen !== 'gameOver') return
      resetGame(s, seed)
    },

    keyDown(s, key: string) {
      if (s.screen !== 'playing' || s.isReplay) return
      const bound = KEY_BINDINGS[key]
      if (!bound || s.input[bound]) return
      s.input[bound] = true
      recordInput(s, bound, true)
    },

    keyUp(s, key: string) {
      // Deliberately not gated on `screen`: a key release must always land, or
      // pausing mid-move latches the input and the ship drifts on resume.
      if (s.isReplay) return
      const bound = KEY_BINDINGS[key]
      if (!bound || !s.input[bound]) return
      s.input[bound] = false
      recordInput(s, bound, false)
    },

    pause(s) {
      if (s.screen === 'playing') s.screen = 'paused'
      else if (s.screen === 'paused') s.screen = 'playing'
    },

    /** Esc — abandon the run and go back to the main menu.
     *
     *  Refused on `nameEntry`: the player is four keystrokes from banking a
     *  qualifying score, and silently forfeiting it to a stray Esc is the kind
     *  of loss you cannot undo. Finish or submit, then Esc. */
    quitToTitle(s) {
      if (s.screen === 'title' || s.screen === 'nameEntry') return
      abandonRun(s)
    },

    /** Replay the last finished game by re-running its input tape. */
    startReplay(s) {
      if (s.screen !== 'gameOver' || !s.lastReplay) return
      const tape = s.lastReplay
      resetGame(s, tape.seed)
      s.lastReplay = tape
      s.isReplay = true
      s.replayCursor = 0
    },

    /** Name-entry text editing. Submitting is the root component's job: it owns
     *  the write to the `scores` cell (a sync method cannot reach another cell,
     *  dep/aio/docs/state/cells.md#sync-methods). */
    nameEntryKey(s, key: string) {
      if (s.screen !== 'nameEntry') return
      if (key === 'Backspace') {
        s.nameEntry = s.nameEntry.slice(0, -1)
        return
      }
      if (s.nameEntry.length >= NAME_LENGTH) return
      if (/^[A-Za-z0-9]$/.test(key)) s.nameEntry += key.toUpperCase()
    },

    finishNameEntry(s) {
      if (s.screen !== 'nameEntry') return
      s.nameEntry = ''
      s.screen = 'gameOver'
    },

    /** Kept in sync from the `scores` cell so `qualifies()` stays local. */
    setQualifyThreshold(s, threshold: number) {
      s.qualifyThreshold = threshold
    },

    tick(s) {
      step(s)
    },
  },
})

export { qualifies }
