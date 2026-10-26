import { assert } from '@std/assert'
import { clearRate } from './bot.ts'

/** The difficulty curve, measured by the bot (tests/bot.ts) — run
 *  `deno task difficulty` for the full table. Bands are loose enough for 30
 *  seeds, tight enough to catch a tuning change that breaks the promise:
 *  1 doable · 2 difficult · 3 extreme yet doable · 4 the best only · 5 ~never. */
Deno.test('difficulty: each wave sits in its band, and each is harder than the last', () => {
  const runs = 30
  const rates = [1, 2, 3, 4, 5].map((w) => clearRate(w, runs))
  const bands: [number, number][] = [[0.6, 1], [0.3, 0.75], [0.12, 0.5], [0, 0.15], [0, 0]]
  rates.forEach((r, i) => {
    const [lo, hi] = bands[i]
    assert(r >= lo && r <= hi, `wave ${i + 1} clear rate ${r} outside [${lo}, ${hi}]`)
  })
  for (let i = 1; i < 4; i++) assert(rates[i] < rates[i - 1], `wave ${i + 1} is not harder than wave ${i}`)
})
