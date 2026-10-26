/** Pixel-art tables. These are render data, not game rules — the simulation
 *  only knows an invader's type index (see features/game/sprites.ts). */
export type Sprite = string[]

export const SPRITES: {
  invader1: [Sprite, Sprite]
  invader2: [Sprite, Sprite]
  invader3: [Sprite, Sprite]
  player: [Sprite]
  ufo: [Sprite]
  /** Glyphs the pixel font lacks. */
  left: [Sprite]
  right: [Sprite]
  note: [Sprite]
  play: [Sprite]
} = {
  left: [['   0', '  00', ' 000', '0000', ' 000', '  00', '   0']],
  right: [['0   ', '00  ', '000 ', '0000', '000 ', '00  ', '0   ']],
  note: [[' 0  ', ' 00 ', ' 0 0', ' 0  ', '00  ', '00  ']],
  play: [['0  ', '00 ', '000', '00 ', '0  ']],
  invader1: [
    [
      '  0    0  ',
      '   0  0   ',
      '  000000  ',
      ' 00 00 00 ',
      '0000000000',
      '0 000000 0',
      '0 0    0 0',
      '   00 00  ',
    ],
    [
      '  0    0  ',
      '0  0  0  0',
      '0 000000 0',
      '000 00 000',
      '0000000000',
      ' 0000000  ',
      '  0    0  ',
      ' 0      0 ',
    ],
  ],
  invader2: [
    [
      '   00     ',
      '  0000    ',
      ' 000000   ',
      '00 00 00  ',
      '00000000  ',
      '  0  0    ',
      ' 0 00 0   ',
      '0 0  0 0  ',
    ],
    [
      '   00     ',
      '  0000    ',
      ' 000000   ',
      '00 00 00  ',
      '00000000  ',
      ' 0 00 0   ',
      '0      0  ',
      ' 0    0   ',
    ],
  ],
  invader3: [
    [
      '    00    ',
      '   0000   ',
      '  000000  ',
      ' 00 00 00 ',
      ' 00000000 ',
      '   0  0   ',
      '  0 00 0  ',
      '00      00',
    ],
    [
      '    00    ',
      '   0000   ',
      '  000000  ',
      ' 00 00 00 ',
      ' 00000000 ',
      '  0 00 0  ',
      '  0    0  ',
      '   0  0   ',
    ],
  ],
  player: [
    [
      '     0     ',
      '    000    ',
      '    000    ',
      ' 000000000 ',
      '00000000000',
      '00000000000',
      '00000000000',
    ],
  ],
  ufo: [
    [
      '    000000    ',
      '  0000000000  ',
      ' 000000000000 ',
      '00 00 00 00 00',
      '00000000000000',
      '   00  0 00   ',
      '    0    0    ',
    ],
  ],
}

export type SpriteKey = keyof typeof SPRITES
