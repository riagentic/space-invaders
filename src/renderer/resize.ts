import { VW, VH } from '../features/game/constants.ts'

const HUD_VIRTUAL_HEIGHT = 44
const TOTAL_ASPECT = VW / (VH + HUD_VIRTUAL_HEIGHT)

export type ScaleInfo = {
  scale: number
  wrapperW: number
  wrapperH: number
  canvasW: number
  canvasH: number
}

export function computeScale(windowW: number, windowH: number): ScaleInfo {
  const padding = 16
  const availW = windowW - padding
  const availH = windowH - padding

  let wrapperW: number, wrapperH: number
  if (availW / availH > TOTAL_ASPECT) {
    wrapperH = availH
    wrapperW = wrapperH * TOTAL_ASPECT
  } else {
    wrapperW = availW
    wrapperH = wrapperW / TOTAL_ASPECT
  }

  const scale = wrapperW / VW
  const canvasW = wrapperW
  const canvasH = wrapperH - HUD_VIRTUAL_HEIGHT * scale

  return { scale, wrapperW, wrapperH, canvasW, canvasH }
}
