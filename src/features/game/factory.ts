import type { Invader, ShieldPixel } from './types.ts'
import { INVADER_TYPES } from './sprites.ts'
import {
  INVADER_COLS, INVADER_ROWS, INVADER_SPACING_X, INVADER_SPACING_Y,
  INVADER_OFFSET_X, INVADER_OFFSET_Y, SHIELD_COUNT, SHIELD_SCALE,
  SHIELD_Y, VW,
} from './constants.ts'

const SHIELD_PATTERN = [
  '  000000  ',
  ' 00000000 ',
  '0000000000',
  '0000000000',
  '0000000000',
  '0000000000',
  '000    000',
  '00      00',
]

/** `descend`: extra px the grid starts lower — later waves begin closer. */
export function createInvaders(descend = 0): Invader[] {
  const invaders: Invader[] = []
  for (let row = 0; row < INVADER_ROWS; row++) {
    const t = INVADER_TYPES[row]
    for (let col = 0; col < INVADER_COLS; col++) {
      invaders.push({
        x: INVADER_OFFSET_X + col * INVADER_SPACING_X,
        y: INVADER_OFFSET_Y + descend + row * INVADER_SPACING_Y,
        type: row,
        color: t.color,
        points: t.points,
        alive: true,
        row,
        col,
      })
    }
  }
  return invaders
}

export function createShields(): ShieldPixel[][] {
  const shields: ShieldPixel[][] = []
  const spacing = VW / (SHIELD_COUNT + 1)
  for (let i = 0; i < SHIELD_COUNT; i++) {
    const sx = spacing * (i + 1) - (SHIELD_PATTERN[0].length * SHIELD_SCALE) / 2
    const pixels: ShieldPixel[] = []
    for (let r = 0; r < SHIELD_PATTERN.length; r++) {
      for (let c = 0; c < SHIELD_PATTERN[r].length; c++) {
        if (SHIELD_PATTERN[r][c] === '0') {
          pixels.push({
            x: sx + c * SHIELD_SCALE,
            y: SHIELD_Y + r * SHIELD_SCALE,
            w: SHIELD_SCALE,
            h: SHIELD_SCALE,
            alive: true,
          })
        }
      }
    }
    shields.push(pixels)
  }
  return shields
}
