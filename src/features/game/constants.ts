export const VW = 640
export const VH = 480
export const PLAYER_SPEED = 5
export const PLAYER_Y = VH - 45
export const PLAYER_W = 33
export const PLAYER_H = 21
export const BULLET_SPEED = 8
export const BULLET_W = 3
export const BULLET_H = 10
export const INVADER_DROP = 14
export const INVADER_COLS = 11
export const INVADER_ROWS = 5
export const INVADER_SPACING_X = 46
export const INVADER_SPACING_Y = 36
export const INVADER_OFFSET_X = (VW - INVADER_COLS * INVADER_SPACING_X) / 2 + 10
export const INVADER_OFFSET_Y = 60
export const UFO_INTERVAL = 900
export const UFO_SPEED = 2
export const SHIELD_COUNT = 4
export const SHIELD_SCALE = 4
export const SHIELD_Y = VH - 110

/** One wave's difficulty. Every knob that makes a wave harder lives here.
 *  - march: frames per invader step with a full grid (quickens as it thins)
 *  - fire: per-frame chance each bottom invader shoots
 *  - cap: most invader shots in the air at once
 *  - bomb: invader shot speed, px/frame
 *  - aim: how many times likelier the shooter nearest the cannon fires
 *  - descent: px the grid starts lower than wave 1
 *  - sprint: top invader speed, px/frame, reached as the last ones race */
export type WaveTuning = {
  march: number
  fire: number
  cap: number
  bomb: number
  aim: number
  descent: number
  sprint: number
}

/** The curve, measured with the bot in tests/difficulty.test.ts:
 *  1 doable · 2 difficult · 3 extreme yet doable · 4 the best only ·
 *  5+ one in a million. Waves past the table reuse its last row. */
export const WAVES: WaveTuning[] = [
  { march: 40, fire: 0.004, cap: 2, bomb: 4, aim: 2, descent: 0, sprint: 2 },
  { march: 20, fire: 0.019, cap: 4, bomb: 5.6, aim: 5, descent: 24, sprint: 3 },
  { march: 16, fire: 0.024, cap: 5, bomb: 6.2, aim: 7, descent: 32, sprint: 4 },
  { march: 14, fire: 0.03, cap: 7, bomb: 7.2, aim: 9, descent: 40, sprint: 4.5 },
  { march: 8, fire: 0.045, cap: 10, bomb: 8.5, aim: 14, descent: 72, sprint: 7 },
]

export const waveTuning = (wave: number): WaveTuning => WAVES[Math.min(Math.max(wave, 1), WAVES.length) - 1]

export const BASE_MOVE_INTERVAL = WAVES[0].march
