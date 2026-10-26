import type { GameState } from '../features/game/types.ts'
import { type FrameSnapshot, sameRun } from './snapshot.ts'
import { ARCADE_FONT } from './fonts.ts'
import { POWER_LOOK } from './canvas.ts'

export type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  decay: number
  size: number
  color: string
}

export type Popup = {
  x: number
  y: number
  text: string
  life: number
  color: string
}

/** An expanding shockwave circle. */
export type Ring = { x: number; y: number; r: number; life: number; color: string }
/** A short-lived bloom of light at the heart of a blast. */
export type Glow = { x: number; y: number; r: number; life: number; color: string }

export type VisualEffects = {
  particles: Particle[]
  popups: Popup[]
  rings: Ring[]
  glows: Glow[]
  /** Full-screen white flash strength, 0..1; decays every frame. */
  flash: number
  /** Screen-shake strength in virtual px; decays every frame. */
  shake: number
}

export const POPUP_LIFE = 40

export function createVisualEffects(): VisualEffects {
  return { particles: [], popups: [], rings: [], glows: [], flash: 0, shake: 0 }
}

/** `rand` is injectable so tests get a deterministic burst. */
export function spawnExplosion(
  fx: VisualEffects,
  x: number,
  y: number,
  color: string,
  count = 12,
  rand: () => number = Math.random,
): void {
  fx.glows.push({ x, y, r: 10 + count, life: 1, color })
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 / count) * i + rand() * 0.5
    const speed = 1 + rand() * 3
    fx.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      decay: 0.02 + rand() * 0.03,
      size: 1 + rand() * 2,
      color,
    })
  }
}

export function spawnPopup(fx: VisualEffects, x: number, y: number, text: string, color: string): void {
  fx.popups.push({ x, y, text, life: POPUP_LIFE, color })
}

export const SHAKE_DECAY = 0.85

/** Camera offset for this frame, in virtual px. */
export function shakeOffset(fx: VisualEffects, rand: () => number = Math.random): { dx: number; dy: number } {
  if (fx.shake < 0.5) return { dx: 0, dy: 0 }
  return { dx: (rand() * 2 - 1) * fx.shake, dy: (rand() * 2 - 1) * fx.shake }
}

export function spawnRing(fx: VisualEffects, x: number, y: number, color: string): void {
  fx.rings.push({ x, y, r: 4, life: 1, color })
}

export function updateVisualEffects(fx: VisualEffects): void {
  fx.shake = fx.shake < 0.5 ? 0 : fx.shake * SHAKE_DECAY
  fx.flash = fx.flash < 0.02 ? 0 : fx.flash * 0.82
  for (let i = fx.glows.length - 1; i >= 0; i--) {
    fx.glows[i].life -= 0.09
    if (fx.glows[i].life <= 0) fx.glows.splice(i, 1)
  }
  for (let i = fx.rings.length - 1; i >= 0; i--) {
    const r = fx.rings[i]
    r.r += 3.5
    r.life -= 0.04
    if (r.life <= 0) fx.rings.splice(i, 1)
  }
  for (let i = fx.particles.length - 1; i >= 0; i--) {
    const p = fx.particles[i]
    p.x += p.vx
    p.y += p.vy
    p.life -= p.decay
    if (p.life <= 0) fx.particles.splice(i, 1)
  }
  for (let i = fx.popups.length - 1; i >= 0; i--) {
    const p = fx.popups[i]
    p.y -= 0.5
    p.life--
    if (p.life <= 0) fx.popups.splice(i, 1)
  }
}

/** Effects are the one thing NOT drawn as pixel art: smooth, glowing and
 *  additive ('lighter'), so overlapping light sums like real light — a modern
 *  layer over the retro sprites. Halo + core instead of shadowBlur keeps a
 *  hundred sparks cheap. */
export function drawVisualEffects(ctx: CanvasRenderingContext2D, fx: VisualEffects, S: number): void {
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'

  for (const g of fx.glows) {
    const cx = g.x * S
    const cy = g.y * S
    const r = g.r * (1.4 - g.life * 0.4) * S
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    grad.addColorStop(0, '#fff')
    grad.addColorStop(0.25, g.color)
    grad.addColorStop(1, 'transparent')
    ctx.globalAlpha = g.life * 0.8
    ctx.fillStyle = grad
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  }

  for (const r of fx.rings) {
    ctx.strokeStyle = r.color
    for (const [width, alpha] of [[10, 0.12], [2.5, 0.9]]) {
      ctx.globalAlpha = r.life * alpha
      ctx.lineWidth = width * r.life * S
      ctx.beginPath()
      ctx.arc(r.x * S, r.y * S, r.r * S, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  for (const p of fx.particles) {
    // A streak along the velocity: a soft wide stroke, then a hot thin core.
    const x0 = (p.x - p.vx * 5) * S
    const y0 = (p.y - p.vy * 5) * S
    ctx.strokeStyle = p.color
    ctx.globalAlpha = p.life * 0.45
    ctx.lineWidth = p.size * 2.5 * S
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(p.x * S, p.y * S)
    ctx.stroke()
    ctx.globalAlpha = p.life
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = Math.max(1, p.size * 0.8 * S)
    ctx.beginPath()
    ctx.moveTo((p.x - p.vx * 2) * S, (p.y - p.vy * 2) * S)
    ctx.lineTo(p.x * S, p.y * S)
    ctx.stroke()
  }

  if (fx.flash > 0) {
    ctx.globalAlpha = fx.flash
    ctx.fillStyle = '#fff'
    ctx.fillRect(-ctx.canvas.width, -ctx.canvas.height, ctx.canvas.width * 3, ctx.canvas.height * 3)
  }

  ctx.globalCompositeOperation = 'source-over'
  for (const p of fx.popups) {
    ctx.globalAlpha = p.life / POPUP_LIFE
    ctx.font = `${10 * S}px ${ARCADE_FONT}`
    ctx.fillStyle = p.color
    ctx.fillText(p.text, p.x * S, p.y * S)
  }
  ctx.globalAlpha = 1
}

/** Spawn effects for everything that changed between the previous frame's
 *  snapshot and the live state. */
export function detectAndSpawnEffects(
  fx: VisualEffects,
  prev: FrameSnapshot | null,
  next: GameState,
  rand: () => number = Math.random,
): void {
  if (!prev || !sameRun(prev, next)) return

  for (let i = 0; i < next.invaders.length; i++) {
    if (prev.aliveMask[i] && !next.invaders[i].alive) {
      const inv = next.invaders[i]
      spawnExplosion(fx, inv.x + 15, inv.y + 10, inv.color, 16, rand)
      spawnPopup(fx, inv.x + 5, inv.y, String(inv.points), inv.color)
    }
  }

  if (prev.screen === 'playing' && next.screen === 'dying') {
    spawnExplosion(
      fx,
      next.player.x + next.player.w / 2,
      next.player.y + next.player.h / 2,
      '#00f0ff',
      40,
      rand,
    )
    spawnRing(fx, next.player.x + next.player.w / 2, next.player.y + next.player.h / 2, '#00f0ff')
    fx.shake = 10
    fx.flash = 0.15
  }

  if (next.lives > prev.lives) {
    spawnPopup(fx, next.player.x - 4, next.player.y - 10, '1UP!', '#39ff14')
  }

  // Power pickups: a timer that jumped up, or a shield that appeared.
  const px = next.player.x - 20
  const py = next.player.y - 22
  if (next.player.rapid > prev.rapid) spawnPopup(fx, px, py, POWER_LOOK.rapid.name, POWER_LOOK.rapid.color)
  if (next.player.triple > prev.triple) spawnPopup(fx, px, py, POWER_LOOK.triple.name, POWER_LOOK.triple.color)
  if (next.player.shield && !prev.shield) spawnPopup(fx, px, py, POWER_LOOK.shield.name, POWER_LOOK.shield.color)
  // A shield that took a hit pops in a green burst.
  if (prev.shield && !next.player.shield && prev.screen === 'playing') {
    spawnExplosion(fx, next.player.x + next.player.w / 2, next.player.y, POWER_LOOK.shield.color, 20, rand)
    spawnRing(fx, next.player.x + next.player.w / 2, next.player.y + next.player.h / 2, POWER_LOOK.shield.color)
  }

  if (prev.ufo && next.ufoHits > prev.ufoHits) {
    spawnExplosion(fx, prev.ufo.x + 21, prev.ufo.y + 10, '#ff2975', 32, rand)
    spawnRing(fx, prev.ufo.x + 21, prev.ufo.y + 10, '#ff2975')
    fx.shake = Math.max(fx.shake, 5)
    fx.flash = 0.25
    spawnPopup(fx, prev.ufo.x + 5, prev.ufo.y, String(next.score - prev.score), '#ff2975')
  }
}
