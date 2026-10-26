import { onCleanup, onMount, useRaf, useRef, useSignal } from 'aio/air'
// AIR API surface for this app: dep/aio/docs/ui/air-reference.md
import { game, NAME_LENGTH } from './features/game/index.ts'
import { qualifyThreshold, scores } from './features/scores/index.ts'
import type { GameState } from './features/game/types.ts'
import { createStars, type Star } from './renderer/canvas.ts'
import { createVisualEffects, type VisualEffects } from './renderer/particles.ts'
import { type Audio, createAudio } from './renderer/audio.ts'
import type { FrameSnapshot } from './renderer/snapshot.ts'
import { fixedSteps, frame, TICK_MS } from './renderer/frame.ts'
import { type FpsState, initialFps, sampleFps } from './renderer/fps.ts'
import { computeScale, type ScaleInfo } from './renderer/resize.ts'
import { type Sprite, SPRITES } from './renderer/sprites.ts'

/** Reading a field off the cell is tracked, reactive direct cell access
 *  (dep/aio/docs/clients/browser.md#direct-cell-access-recommended). The cell
 *  ref therefore *is* a live GameState for read-only consumers like the
 *  renderer, which needs the whole slice each frame. */
const liveState = game as unknown as GameState

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null!)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  // A signal, not a ref: the wrapper's size must re-render on resize even on
  // screens where nothing is ticking (title, pause, game over).
  const scaleSig = useSignal<ScaleInfo>(initialScale())
  const prevRef = useRef<FrameSnapshot | null>(null)
  // `useRef(x)` evaluates `x` on every render and keeps only the first, so the
  // per-frame objects are built lazily — otherwise each render allocated a
  // fresh 80-star field and a new audio engine just to throw them away.
  const fxRef = useRef<VisualEffects | null>(null)
  const starsRef = useRef<Star[] | null>(null)
  const audioRef = useRef<Audio | null>(null)
  const fpsRef = useRef<FpsState>(initialFps())
  const fpsSig = useSignal(0)
  const frameErrors = useRef(0)
  // Fixed-timestep clock: last frame time and leftover milliseconds.
  const clockRef = useRef({ last: 0, acc: 0 })
  // Focus was lost while the game could not pause yet (dying, wave break):
  // pause the moment play resumes.
  const pauseOwedRef = useRef(false)
  const mutedSig = useSignal(false)
  fxRef.current ??= createVisualEffects()
  starsRef.current ??= createStars()
  audioRef.current ??= createAudio()
  const fx = fxRef.current
  const stars = starsRef.current
  const audio = audioRef.current

  /** Refresh the leaderboard bar, then start. The threshold lets the game cell
   *  decide on its own whether a final score earns a name-entry prompt. */
  const beginGame = (start: (seed: number) => void) => {
    game.setQualifyThreshold(qualifyThreshold(scores.entries))
    start(Date.now())
  }

  const submitName = () => {
    const name = game.nameEntry.padEnd(NAME_LENGTH, ' ').slice(0, NAME_LENGTH)
    scores.submit({ name, score: game.score, wave: game.wave })
    game.finishNameEntry()
  }

  // Responsive layout — attach once, detach on unmount.
  onMount(() => {
    const view = hostWindow(canvasRef.current)
    const onResize = () => {
      // The themed title bar pads the body (0 in a browser tab, where aio
      // does not mount it) — the cabinet fits in what is left.
      const top = parseFloat(view.getComputedStyle(view.document.body).paddingTop) || 0
      const next = computeScale(view.innerWidth, view.innerHeight - top)
      scaleSig.set(next)
      const canvas = canvasRef.current
      if (canvas) {
        canvas.width = next.canvasW
        canvas.height = next.canvasH
      }
    }
    ctxRef.current = canvasRef.current?.getContext('2d', { desynchronized: true }) ?? null
    view.addEventListener('resize', onResize)
    onResize()
    onCleanup(() => view.removeEventListener('resize', onResize))
  })

  // Keyboard — the whole game is playable without a mouse.
  onMount(() => {
    const onKeyDown = (evt: Event) => {
      const e = evt as KeyboardEvent
      const screen = game.screen
      // F11: the whole cabinet fullscreen, and back. The page's own fullscreen
      // permission is granted by aio (dep/aio/docs/clients/electron.md,
      // "Permissions"), so one call serves the window and a browser tab.
      if (e.key === 'F11') {
        e.preventDefault()
        if (e.repeat) return
        const doc = view.document
        if (doc.fullscreenElement) doc.exitFullscreen().catch(() => {})
        else doc.documentElement.requestFullscreen().catch(() => {})
        return
      }
      // Auto-repeat only matters for typing initials; anywhere else a held
      // Enter would skip straight through the game-over screen.
      if (e.repeat && screen !== 'nameEntry') {
        if (e.key === ' ') e.preventDefault()
        return
      }
      // Browsers start audio suspended until a gesture; Electron does not.
      audio.unlock()
      if ((e.key === 'm' || e.key === 'M') && screen !== 'nameEntry') {
        mutedSig.set(audio.toggleMute())
        return
      }
      if (screen === 'title' && (e.key === 'Enter' || e.key === ' ')) {
        beginGame((seed) => game.startGame(seed))
        e.preventDefault()
        return
      }
      // Enter restarts — unless a button has focus, where Enter must activate
      // that button (tabbing to REPLAY and pressing Enter should replay, not
      // start a new game).
      if (screen === 'gameOver' && e.key === 'Enter') {
        if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return
        beginGame((seed) => game.restart(seed))
        e.preventDefault()
        return
      }
      if (screen === 'gameOver' && (e.key === 'r' || e.key === 'R')) {
        game.startReplay()
        e.preventDefault()
        return
      }
      if (screen === 'nameEntry') {
        if (e.key === 'Enter') {
          submitName()
          e.preventDefault()
          return
        }
        game.nameEntryKey(e.key)
        return
      }
      if (e.key === 'Escape') {
        game.quitToTitle()
        e.preventDefault()
        return
      }
      if ((e.key === 'p' || e.key === 'P') && (screen === 'playing' || screen === 'paused')) {
        game.pause()
        return
      }
      game.keyDown(e.key)
      if (e.key === ' ' && screen === 'playing') e.preventDefault()
    }
    // Releases are never filtered by screen — see game cell's keyUp.
    const onKeyUp = (evt: Event) => {
      game.keyUp((evt as KeyboardEvent).key)
    }

    // Losing focus mid-wave is not a fair death — pause instead. Held keys are
    // released too: their keyup will land in another window.
    const onBlur = () => {
      for (const key of ['ArrowLeft', 'ArrowRight', ' ']) game.keyUp(key)
      if (game.screen === 'playing') game.pause()
      else pauseOwedRef.current = game.screen === 'dying' || game.screen === 'waveClear'
    }
    const onFocus = () => {
      pauseOwedRef.current = false
    }

    const view = hostWindow(canvasRef.current)
    view.addEventListener('keydown', onKeyDown)
    view.addEventListener('keyup', onKeyUp)
    view.addEventListener('blur', onBlur)
    view.addEventListener('focus', onFocus)
    onCleanup(() => {
      view.removeEventListener('keydown', onKeyDown)
      view.removeEventListener('keyup', onKeyUp)
      view.removeEventListener('blur', onBlur)
      view.removeEventListener('focus', onFocus)
      audio.dispose()
    })
  })

  // Frame loop. The body lives in renderer/frame.ts so it is testable — a rAF
  // callback never runs under the test harness.
  useRaf(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const now = performance.now()

    // Publish only when the meter closes a window — a signal write per frame
    // would re-render the whole tree 60x/s to change one number.
    const nextFps = sampleFps(fpsRef.current, now)
    fpsRef.current = nextFps
    if (nextFps.fps !== fpsSig.value) fpsSig.set(nextFps.fps)

    if (pauseOwedRef.current && game.screen === 'playing') {
      pauseOwedRef.current = false
      game.pause()
    }
    const clock = clockRef.current
    const { steps, acc } = fixedSteps(clock.acc, clock.last ? now - clock.last : TICK_MS)
    clockRef.current = { last: now, acc }

    // A throw inside a rAF callback would end the loop for good and freeze the
    // cabinet. Report the first one (aio forwards console.error to client.log,
    // dep/aio/docs/debugging/errors.md) and keep the game running.
    try {
      prevRef.current = frame({
        ctx,
        state: liveState,
        prev: prevRef.current,
        fx,
        stars,
        audio,
        scale: scaleSig.value.scale,
        timeMs: now,
        tick: () => game.tick(),
        steps,
        recordScore: (score) => scores.recordScore(score),
      })
    } catch (err) {
      if (frameErrors.current++ === 0) console.error('[space-invaders] frame failed:', err)
    }
  })

  const { wrapperW, wrapperH, scale } = scaleSig.value
  const screen = game.screen

  return (
    <div id="game-wrapper" style={{ width: wrapperW, height: wrapperH, fontSize: Math.max(8, 11 * scale) }}>
      <Hud muted={mutedSig.value} />
      <div id="canvas-container">
        <canvas id="game" ref={canvasRef} />
        <div id="scanlines" aria-hidden="true" />
        <div id="rollband" aria-hidden="true" />
        <div id="vignette" aria-hidden="true" />
        <TitleScreen hidden={screen !== 'title'} />
        <NameEntryScreen hidden={screen !== 'nameEntry'} />
        <GameOverScreen hidden={screen !== 'gameOver'} onReplay={() => game.startReplay()} />
        <PauseScreen hidden={screen !== 'paused'} />
        <div id="fps" t="fps">{fpsSig.value} FPS</div>
      </div>
    </div>
  )
}

/** The window the app is actually mounted in.
 *
 *  Not `globalThis`: under the test harness the DOM is a separate window
 *  object, so listeners bound to the ambient global would never see a real
 *  keystroke — and in the browser this resolves to exactly the same `window`.
 *  Binding to the host document is both more correct and what makes the
 *  keyboard testable end-to-end. */
function hostWindow(el: Element | null): Window {
  return (el?.ownerDocument?.defaultView ?? globalThis) as unknown as Window
}

function initialScale(): ScaleInfo {
  const w = globalThis.innerWidth || 800
  const h = globalThis.innerHeight || 650
  return computeScale(w, h)
}

function Hud({ muted }: { muted: boolean }) {
  return (
    <div id="hud">
      <div>
        <div className="score-label">SCORE</div>
        <div id="score" t="hud-score">{String(game.score).padStart(4, '0')}</div>
      </div>
      <div className="level-badge">WAVE <span id="level" t="hud-wave">{game.wave}</span></div>
      <div>
        <div className="score-label">HI-SCORE</div>
        <div id="hi-score" t="hud-hiscore">{String(scores.hiScore).padStart(4, '0')}</div>
      </div>
      <div className="lives" id="lives">
        {Array.from({ length: game.lives }, (_, i) => <LifeIcon key={i} />)}
      </div>
      <div className="music-state" t="hud-music"><Glyph name="note" /> {muted ? 'OFF' : 'ON'}</div>
    </div>
  )
}

/** Sprite rows as crisp SVG pixels — the HUD and menus share the canvas's
 *  pixel art, so every icon reads as the same machine. Each character other
 *  than a space becomes a pixel classed `px-<char>` for CSS to colour. */
function PixelArt({ sprite, className }: { sprite: Sprite; className: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${sprite[0].length} ${sprite.length}`}
      shape-rendering="crispEdges"
      aria-hidden="true"
    >
      {sprite.flatMap((row, y) =>
        row.split('').map((ch, x) =>
          ch === ' ' ? null : <rect key={`${x}-${y}`} className={`px-${ch}`} x={x} y={y} width={1} height={1} />
        )
      )}
    </svg>
  )
}

/** A pixel symbol inline with text, for characters the font does not have. */
const Glyph = ({ name }: { name: 'left' | 'right' | 'note' | 'play' }) => (
  <PixelArt sprite={SPRITES[name][0]} className="glyph" />
)

/** One life: the player's own ship, as in the original's reserve row. */
const LifeIcon = () => <PixelArt sprite={SPRITES.player[0]} className="life" />

/** A title-screen invader marching between its two frames, like in play. */
function MarchingInvader({ frames, color }: { frames: [Sprite, Sprite]; color: string }) {
  return (
    <div className="inv" style={{ color }}>
      <PixelArt sprite={frames[0]} className="frame-a" />
      <PixelArt sprite={frames[1]} className="frame-b" />
    </div>
  )
}

function TitleScreen({ hidden }: { hidden: boolean }) {
  return (
    <div className={overlayClass(hidden)} id="title-screen">
      <div className="invader-art">
        <MarchingInvader frames={SPRITES.invader3} color="var(--neon-pink)" />
        <MarchingInvader frames={SPRITES.invader1} color="var(--neon-purple)" />
        <MarchingInvader frames={SPRITES.invader2} color="var(--neon-cyan)" />
      </div>
      <h1>SPACE INVADERS</h1>
      <div className="subtitle">DEFEND EARTH AT ALL COSTS</div>
      <div className="prompt">PRESS ENTER OR SPACE TO START</div>
      <div className="controls-info">
        <span><Glyph name="left" /> <Glyph name="right" /></span> OR <span>A D</span> MOVE &nbsp;&nbsp; <span>SPACE</span> FIRE<br />
        <span>P</span> PAUSE &nbsp;&nbsp; <span>M</span> MUSIC &nbsp;&nbsp; <span>F11</span> FULLSCREEN &nbsp;&nbsp; <span>ESC</span> MENU<br />
        BONUS CANNON AT 1500 · CATCH <span>R</span><span>T</span><span>S</span><span>L</span> POWER-UPS
      </div>
      <div className="credit" t="credit">USING AIO FRAMEWORK &copy; RIAGENTIC 2026</div>
    </div>
  )
}

function NameEntryScreen({ hidden }: { hidden: boolean }) {
  const typed = game.nameEntry
  const slots = typed.padEnd(NAME_LENGTH, ' ').slice(0, NAME_LENGTH).split('')
  return (
    <div className={overlayClass(hidden)} id="name-entry-screen">
      <h1 className="neon-yellow">HIGH SCORE!</h1>
      <div className="subtitle">ENTER YOUR INITIALS</div>
      <div className="final-score">SCORE: <span>{game.score}</span></div>
      <div className="name-display" t="name-display">
        {slots.map((ch, i) => (
          <span key={i} className={i < typed.length ? 'name-char filled' : 'name-char'}>
            {ch === ' ' ? '_' : ch}
          </span>
        ))}
      </div>
      <div className="prompt">TYPE {NAME_LENGTH} CHARS · ENTER TO SUBMIT</div>
    </div>
  )
}

function GameOverScreen({ hidden, onReplay }: { hidden: boolean; onReplay: () => void }) {
  const entries = scores.entries
  const canReplay = game.lastReplay !== null
  return (
    <div className={overlayClass(hidden)} id="gameover-screen">
      <h1 className="neon-pink">GAME OVER</h1>
      <div className="subtitle gameover-subtitle">THE INVASION SUCCEEDED</div>
      <div className="final-score">SCORE: <span>{game.score}</span></div>
      <div className="high-score">BEST: <span>{scores.hiScore}</span></div>
      {entries.length > 0 && (
        <div className="leaderboard" t="leaderboard">
          <div className="leaderboard-title">HIGH SCORES</div>
          {entries.map((e, i) => (
            <div key={`${e.name}-${e.score}-${i}`} className="leaderboard-row">
              <span className="lb-rank">{i + 1}</span>
              <span className="lb-name">{e.name}</span>
              <span className="lb-score">{String(e.score).padStart(4, '0')}</span>
              <span className="lb-wave">W{e.wave}</span>
            </div>
          ))}
        </div>
      )}
      <div className="prompt">PRESS ENTER TO TRY AGAIN</div>
      <div className="replay-block">
        <div className="prompt neon-cyan">PRESS R TO REPLAY LAST GAME</div>
        <button type="button" t="replay" className="replay-btn" disabled={!canReplay} onClick={onReplay}>
          {canReplay ? <><Glyph name="play" /> REPLAY LAST GAME</> : 'NO REPLAY YET'}
        </button>
      </div>
    </div>
  )
}

function PauseScreen({ hidden }: { hidden: boolean }) {
  return (
    <div className={overlayClass(hidden)} id="pause-screen">
      <h1 className="pause-title">PAUSED</h1>
      <div className="prompt pause-prompt">PRESS P TO RESUME · ESC FOR MENU</div>
    </div>
  )
}

const overlayClass = (hidden: boolean) => (hidden ? 'overlay hidden' : 'overlay')
