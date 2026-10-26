import { aio } from 'aio'
import { game } from './features/game/index.ts'
import { scores } from './features/scores/index.ts'
import { HEAD_TAGS } from './renderer/fonts.ts'

await aio.run({
  appId: 'space-invaders',
  // `game` is scope:'client' — it never registers server-side, but it is listed
  // so aio bundles and boots it in the renderer.
  cells: [game, scores],
  client: 'electron',
  // Fixed port so `deno task am …` works without --port on every call.
  port: 8123,
  ui: {
    title: 'SPACE INVADERS',
    width: 800,
    // +34: the themed title bar (--aio-titlebar-height in style.css).
    height: 684,
    // No OS frame: aio draws a title bar that style.css paints neon
    // (dep/aio/docs/clients/electron.md, "themed"). Ignored in a browser tab.
    chrome: 'themed',
    lang: 'en',
    // Local arcade faces + a CSP that keeps the page off the network.
    head: HEAD_TAGS,
  },
  // Only the `scores` cell persists, and only the fields it whitelists.
  // See dep/aio/docs/persistence/auto-persist.md.
  persist: true,
  perfCheck: 'on',
  perfBudget: { reduce: 16, effect: 5 },
})
