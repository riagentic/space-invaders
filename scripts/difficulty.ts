/** Prints the measured difficulty curve: the bot's clear rate per wave.
 *  Usage: deno task difficulty [runs]   (default 200 runs per wave) */
import { WAVES } from '../src/features/game/constants.ts'
import { playWave } from '../tests/bot.ts'

const runs = Number(Deno.args[0] ?? 200)
for (let wave = 1; wave <= WAVES.length; wave++) {
  let cleared = 0
  let frames = 0
  let lost = 0
  let left = 0
  for (let i = 0; i < runs; i++) {
    const r = playWave(wave, 1 + i * 7919)
    if (r.cleared) cleared++
    frames += r.frames
    lost += r.livesLost
    left += r.left
  }
  const pct = (100 * cleared / runs).toFixed(1).padStart(5)
  const secs = (frames / runs / 60).toFixed(0).padStart(3)
  const why = `invaders left ${(left / runs).toFixed(1)}`
  console.log(`wave ${wave}: cleared ${pct}%  avg ${secs}s  lives lost ${(lost / runs).toFixed(2)}  ${why}`)
}
