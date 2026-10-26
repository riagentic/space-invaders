import { cell } from 'aio'

export type LeaderboardEntry = {
  name: string
  score: number
  wave: number
}

export const LEADERBOARD_SIZE = 5

/** Lowest score that still holds a slot — the bar a new score must clear.
 *  0 while the board has room, so any score above zero qualifies. */
export function qualifyThreshold(entries: LeaderboardEntry[]): number {
  if (entries.length < LEADERBOARD_SIZE) return 0
  return entries[entries.length - 1].score
}

/** The only thing in this game that outlives a tab: the hall of fame.
 *  Server-scoped and persisted, written once per finished game — the opposite
 *  of the `game` cell's 60 Hz churn, which is why they are separate cells
 *  (dep/aio/docs/state/cells.md#shared-vs-per-client-state).
 *
 *  Never rename this cell: aio's `onMigrate` only sees its own cell's stored
 *  state, so a renamed cell starts with an empty board. */
export const scores = cell('scores', {
  state: {
    entries: [] as LeaderboardEntry[],
    hiScore: 0,
  },
  // See dep/aio/docs/persistence/auto-persist.md#per-cell-persistence.
  persist: { include: ['entries', 'hiScore'] },

  methods: {
    /** Remember a score even when it misses the board, so HI-SCORE is honest. */
    recordScore(s, score: number) {
      if (score > s.hiScore) s.hiScore = score
    },

    submit(s, entry: LeaderboardEntry) {
      s.entries.push(entry)
      s.entries.sort((a, b) => b.score - a.score)
      s.entries = s.entries.slice(0, LEADERBOARD_SIZE)
      if (entry.score > s.hiScore) s.hiScore = entry.score
    },
  },
})
