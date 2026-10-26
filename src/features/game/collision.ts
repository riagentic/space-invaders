import type { ShieldPixel } from './types.ts'

type Rect = { x: number; y: number; w: number; h: number }

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function destroyShieldArea(shield: ShieldPixel[], cx: number, cy: number, radius: number): void {
  for (const px of shield) {
    if (px.alive) {
      const dx = px.x - cx
      const dy = px.y - cy
      if (dx * dx + dy * dy < radius * radius) {
        px.alive = false
      }
    }
  }
}
