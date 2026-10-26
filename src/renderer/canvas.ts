import type { GameState } from '../features/game/types.ts'
import { INVADER_TYPES } from '../features/game/sprites.ts'
import { VH, VW } from '../features/game/constants.ts'
import { POWER_H, POWER_W, WAVE_BONUS } from '../features/game/step.ts'
import type { PowerKind } from '../features/game/types.ts'
import { type Sprite, SPRITES, type SpriteKey } from './sprites.ts'
import { ARCADE_FONT } from './fonts.ts'

/** Capsule colour and letter — the same palette the pickup popups use. */
export const POWER_LOOK: Record<PowerKind, { color: string; label: string; name: string }> = {
  rapid: { color: '#ffcf4f', label: 'R', name: 'RAPID FIRE!' },
  triple: { color: '#4fcfff', label: 'T', name: 'TRIPLE SHOT!' },
  shield: { color: '#7dff9a', label: 'S', name: 'SHIELD UP!' },
  life: { color: '#ff4fd8', label: 'L', name: 'EXTRA LIFE!' },
}

export type Star = { x: number; y: number; size: number; speed: number; brightness: number }

export const STAR_COUNT = 80

/** The parallax starfield. Owned by the caller (one field per canvas) rather
 *  than a module global, so it is seedable, testable and never shared between
 *  two renderers by accident. */
export function createStars(rand: () => number = Math.random, count = STAR_COUNT): Star[] {
  const stars: Star[] = []
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rand() * VW,
      y: rand() * VH,
      size: rand() * 1.5 + 0.5,
      speed: rand() * 0.3 + 0.1,
      brightness: rand(),
    })
  }
  return stars
}

function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  vxPos: number,
  vyPos: number,
  color: string,
  S: number,
  pixelScale = 3,
): void {
  ctx.fillStyle = color
  const ps = pixelScale * S
  const sx = vxPos * S
  const sy = vyPos * S
  for (let row = 0; row < sprite.length; row++) {
    for (let col = 0; col < sprite[row].length; col++) {
      if (sprite[row][col] === '0') ctx.fillRect(sx + col * ps, sy + row * ps, ps, ps)
    }
  }
}

/** Advances and draws the starfield. `timeMs` drives the twinkle — a
 *  render-only clock, never the simulation's. */
export function drawStars(
  ctx: CanvasRenderingContext2D,
  S: number,
  stars: Star[],
  timeMs: number,
  rand: () => number = Math.random,
): void {
  for (const s of stars) {
    s.y += s.speed
    if (s.y > VH) {
      s.y = 0
      s.x = rand() * VW
    }
    ctx.globalAlpha = 0.3 + Math.sin(timeMs * 0.003 + s.brightness * 10) * 0.2
    ctx.fillStyle = '#fff'
    ctx.fillRect(s.x * S, s.y * S, s.size * S, s.size * S)
  }
  ctx.globalAlpha = 1
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  S: number,
  stars: Star[],
  timeMs: number,
): void {
  // Oversized on purpose: under screen shake the origin is offset, and a
  // canvas-sized clear would leave a smeared strip along one edge.
  ctx.clearRect(-ctx.canvas.width, -ctx.canvas.height, ctx.canvas.width * 3, ctx.canvas.height * 3)
  ctx.imageSmoothingEnabled = false

  drawStars(ctx, S, stars, timeMs)

  // Ground line
  ctx.strokeStyle = 'rgba(57, 255, 20, 0.2)'
  ctx.lineWidth = Math.max(1, S)
  ctx.beginPath()
  ctx.moveTo(0, (VH - 20) * S)
  ctx.lineTo(ctx.canvas.width, (VH - 20) * S)
  ctx.stroke()

  // Screens that are fully covered by an overlay draw the backdrop only.
  if (
    state.screen === 'title' || state.screen === 'gameOver' ||
    state.screen === 'paused' || state.screen === 'nameEntry'
  ) return

  // Shields
  ctx.fillStyle = '#39ff14'
  ctx.shadowColor = '#39ff14'
  ctx.shadowBlur = 2 * S
  for (const shield of state.shields) {
    for (const px of shield) {
      if (px.alive) ctx.fillRect(px.x * S, px.y * S, px.w * S, px.h * S)
    }
  }
  ctx.shadowBlur = 0

  // Invaders
  for (const inv of state.invaders) {
    if (!inv.alive) continue
    const frames = SPRITES[INVADER_TYPES[inv.type].sprite as SpriteKey]
    drawSprite(ctx, frames[state.invaderFrame] ?? frames[0], inv.x, inv.y, inv.color, S)
  }

  // UFO
  if (state.ufo) {
    ctx.shadowColor = '#ff2975'
    ctx.shadowBlur = 15 * S
    drawSprite(ctx, SPRITES.ufo[0], state.ufo.x, state.ufo.y, '#ff2975', S)
    ctx.shadowBlur = 0
  }

  // Player — blinks while dying and while respawn-invincible
  const dyingBlink = state.screen !== 'dying' || Math.floor(state.dyingTimer / 4) % 2 === 0
  const invincibleBlink = state.player.invincible <= 0 ||
    Math.floor(state.player.invincible / 4) % 2 === 0
  if (dyingBlink && invincibleBlink) {
    ctx.shadowColor = '#00f0ff'
    ctx.shadowBlur = 8 * S
    drawSprite(ctx, SPRITES.player[0], state.player.x, state.player.y, '#00f0ff', S)
    ctx.shadowBlur = 0
    if (state.player.shield) {
      const p = state.player
      // An effect, so smooth and modern: a glowing energy bubble, not pixels.
      const cx = (p.x + p.w / 2) * S
      const cy = (p.y + p.h / 2) * S
      const rx = (p.w / 2 + 9) * S
      const ry = (p.h / 2 + 9) * S
      const pulse = 0.75 + Math.sin(timeMs * 0.008) * 0.25
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx)
      glow.addColorStop(0.55, 'rgba(125, 255, 154, 0)')
      glow.addColorStop(1, `rgba(125, 255, 154, ${0.35 * pulse})`)
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = POWER_LOOK.shield.color
      ctx.shadowColor = POWER_LOOK.shield.color
      ctx.shadowBlur = 12 * S
      ctx.globalAlpha = 0.6 * pulse
      ctx.lineWidth = 1.5 * S
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      ctx.shadowBlur = 0
    }
  }

  // Player shots — the main one plus the triple shot's side shots
  ctx.fillStyle = '#ffe600'
  ctx.shadowColor = '#ffe600'
  ctx.shadowBlur = 6 * S
  for (const b of state.player.bullet ? [state.player.bullet, ...state.player.spread] : state.player.spread) {
    ctx.fillRect(b.x * S, b.y * S, b.w * S, b.h * S)
  }
  ctx.shadowBlur = 0

  // Falling power-up capsule
  if (state.powerUp) {
    const { x, y, kind } = state.powerUp
    const look = POWER_LOOK[kind]
    ctx.fillStyle = look.color
    ctx.shadowColor = look.color
    ctx.shadowBlur = (8 + Math.sin(timeMs * 0.01) * 4) * S
    ctx.fillRect(x * S, y * S, POWER_W * S, POWER_H * S)
    ctx.shadowBlur = 0
    ctx.fillStyle = '#05050f'
    ctx.font = `${9 * S}px ${ARCADE_FONT}`
    ctx.textAlign = 'center'
    ctx.fillText(look.label, (x + POWER_W / 2) * S, (y + POWER_H - 2) * S)
    ctx.textAlign = 'left'
  }

  // Active power timers, bottom-left under the ground line
  const timers = ([['rapid', state.player.rapid], ['triple', state.player.triple]] as const).filter(([, f]) => f > 0)
  ctx.font = `${7 * S}px ${ARCADE_FONT}`
  timers.forEach(([kind, frames], i) => {
    ctx.fillStyle = POWER_LOOK[kind].color
    ctx.fillText(`${POWER_LOOK[kind].label} ${Math.ceil(frames / 60)}`, (8 + i * 48) * S, (VH - 6) * S)
  })

  // Invader bullets — the zigzag is the original game's signature wobble
  for (const b of state.invaderBullets) {
    ctx.fillStyle = b.color
    ctx.shadowColor = b.color
    ctx.shadowBlur = 4 * S
    ctx.fillRect((b.x + Math.sin(b.y * 0.3) * 2) * S, b.y * S, b.w * S, b.h * S)
    ctx.shadowBlur = 0
  }

  // Wave clear announcement
  if (state.screen === 'waveClear') {
    ctx.font = `${16 * S}px ${ARCADE_FONT}`
    ctx.fillStyle = '#ffe600'
    ctx.shadowColor = '#ffe600'
    ctx.shadowBlur = 20 * S
    ctx.textAlign = 'center'
    ctx.fillText(`WAVE ${state.wave} COMPLETE`, ctx.canvas.width / 2, (VH / 2) * S)
    ctx.font = `${10 * S}px ${ARCADE_FONT}`
    ctx.fillStyle = '#39ff14'
    ctx.fillText(`BONUS ${WAVE_BONUS * state.wave}`, ctx.canvas.width / 2, (VH / 2 + 30) * S)
    ctx.fillText(`WAVE ${state.wave + 1} INCOMING`, ctx.canvas.width / 2, (VH / 2 + 50) * S)
    ctx.textAlign = 'left'
    ctx.shadowBlur = 0
  }
}
