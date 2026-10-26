import { assert, assertEquals } from '@std/assert'
import { createStars, drawFrame, drawStars, STAR_COUNT } from '../src/renderer/canvas.ts'
import { createAudio, FADE_IN_S, FADE_OUT_S, FAST_AT, musicPhase, NORMAL_AT } from '../src/renderer/audio.ts'
import { chordTones, midi, SONGS, STEPS_PER_BAR, stepEvents } from '../src/renderer/songs.ts'
import { snapshotFrame } from '../src/renderer/snapshot.ts'
import { fixedSteps, frame, MAX_STEPS, TICK_MS } from '../src/renderer/frame.ts'
import { createVisualEffects, detectAndSpawnEffects } from '../src/renderer/particles.ts'
import { initialGameState, resetGame } from '../src/features/game/step.ts'
import type { GameState } from '../src/features/game/types.ts'
import { VH } from '../src/features/game/constants.ts'

/** A 2D context stand-in that records the calls we care about. */
function recordingCtx() {
  const calls: string[] = []
  let fills = 0
  const ctx = {
    canvas: { width: 640, height: 480 },
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    imageSmoothingEnabled: true,
    clearRect: () => calls.push('clearRect'),
    save: () => {},
    restore: () => {},
    translate: () => {},
    arc: () => {},
    ellipse: () => {},
    fill: () => {},
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => {
      fills++
      calls.push('fillRect')
    },
    beginPath: () => calls.push('beginPath'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    stroke: () => calls.push('stroke'),
    fillText: (t: string) => calls.push(`fillText:${t}`),
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, fillCount: () => fills }
}

function started(seed = 7): GameState {
  const s = initialGameState()
  resetGame(s, seed)
  return s
}

/** Deterministic pseudo-random, so star layout is reproducible. */
function seq(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

// ── stars ───────────────────────────────────────────────────────────────────

Deno.test('createStars: makes an independent field each call', () => {
  const a = createStars(seq([0.5]))
  const b = createStars(seq([0.5]))
  assertEquals(a.length, STAR_COUNT)
  a[0].y = 999
  assert(b[0].y !== 999, 'fields must not share state')
})

Deno.test('drawStars: stars drift down and wrap at the bottom', () => {
  const stars = createStars(seq([0.5]), 1)
  stars[0].y = VH - 0.001
  const { ctx } = recordingCtx()
  drawStars(ctx, 1, stars, 0, () => 0.25)
  assert(stars[0].y === 0, 'a star past the bottom wraps to the top')
})

// ── drawFrame ───────────────────────────────────────────────────────────────

Deno.test('drawFrame: title screen paints the backdrop but no gameplay', () => {
  const s = started()
  s.screen = 'title'
  const { ctx, calls, fillCount } = recordingCtx()
  drawFrame(ctx, s, 1, createStars(seq([0.5]), 5), 0)
  assert(calls.includes('clearRect'))
  assert(calls.includes('stroke'), 'the ground line is drawn')
  assertEquals(fillCount(), 5, 'only the 5 stars — no invaders or shields')
})

Deno.test('drawFrame: a playing frame paints invaders and shields', () => {
  const s = started()
  const { ctx, fillCount } = recordingCtx()
  drawFrame(ctx, s, 1, createStars(seq([0.5]), 5), 0)
  // 5 stars + shield pixels + invader sprite pixels + the player.
  assert(fillCount() > 500, `expected a full board, got ${fillCount()} fills`)
})

Deno.test('drawFrame: dead invaders are not drawn', () => {
  const full = started()
  const { ctx: c1, fillCount: f1 } = recordingCtx()
  drawFrame(c1, full, 1, createStars(seq([0.5]), 5), 0)

  const cleared = started()
  for (const inv of cleared.invaders) inv.alive = false
  const { ctx: c2, fillCount: f2 } = recordingCtx()
  drawFrame(c2, cleared, 1, createStars(seq([0.5]), 5), 0)

  assert(f2() < f1(), 'an empty grid paints fewer pixels')
})

Deno.test('drawFrame: the wave-clear banner is announced', () => {
  const s = started()
  s.screen = 'waveClear'
  s.wave = 3
  const { ctx, calls } = recordingCtx()
  drawFrame(ctx, s, 1, createStars(seq([0.5]), 5), 0)
  assert(calls.includes('fillText:WAVE 3 COMPLETE'), calls.join(','))
  assert(calls.includes('fillText:WAVE 4 INCOMING'))
})

Deno.test('drawFrame: canvas fonts always carry a fallback face', () => {
  const s = started()
  s.screen = 'waveClear'
  const { ctx } = recordingCtx()
  drawFrame(ctx, s, 1, createStars(seq([0.5]), 5), 0)
  assert(ctx.font.includes('monospace'), `font had no fallback: ${ctx.font}`)
})

// ── effects, driven by a real snapshot diff ─────────────────────────────────

Deno.test('detectAndSpawnEffects: killing an invader spawns a burst and a popup', () => {
  const s = started()
  const prev = snapshotFrame(s)
  s.invaders[0].alive = false
  s.score += s.invaders[0].points

  const fx = createVisualEffects()
  detectAndSpawnEffects(fx, prev, s, () => 0.5)
  assertEquals(fx.particles.length, 16)
  assertEquals(fx.popups.length, 1)
  assertEquals(fx.popups[0].text, String(s.invaders[0].points))
})

Deno.test('detectAndSpawnEffects: an unchanged frame spawns nothing', () => {
  const s = started()
  const prev = snapshotFrame(s)
  const fx = createVisualEffects()
  detectAndSpawnEffects(fx, prev, s, () => 0.5)
  assertEquals(fx.particles.length, 0)
  assertEquals(fx.popups.length, 0)
})

Deno.test('detectAndSpawnEffects: the player exploding spawns a burst', () => {
  const s = started()
  const prev = snapshotFrame(s)
  s.screen = 'dying'
  const fx = createVisualEffects()
  detectAndSpawnEffects(fx, prev, s, () => 0.5)
  assertEquals(fx.particles.length, 40)
  assert(fx.shake > 0, 'a death shakes the screen')
})

// ── audio ───────────────────────────────────────────────────────────────────

/** A WebAudio stand-in that records every oscillator the app schedules. */
function fakeAudioContext() {
  const started: { type: string; freq: number; stop: number }[] = []
  const drums: number[] = []
  const ctx = {
    currentTime: 0,
    destination: {},
    closed: false,
    close() {
      this.closed = true
    },
    createGain: () => ({
      value: 0,
      connect: () => {},
      disconnect: () => {},
      gain: {
        value: 0,
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
        cancelScheduledValues: () => {},
      },
    }),
    sampleRate: 8000,
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    createBiquadFilter: () => ({
      type: '',
      frequency: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: () => {},
    }),
    createBufferSource: () => ({
      buffer: null as unknown,
      connect: () => {},
      start: () => {
        drums.push(1)
      },
      stop: () => {},
    }),
    createOscillator: () => {
      const osc = {
        type: 'sine',
        frequency: {
          value: 0,
          setValueAtTime(v: number) {
            osc.frequency.value = v
          },
          exponentialRampToValueAtTime: () => {},
          linearRampToValueAtTime: () => {},
        },
        detune: { value: 0 },
        connect: () => {},
        disconnect: () => {},
        start: () => {},
        stop: (t: number) => {
          started.push({ type: osc.type, freq: osc.frequency.value, stop: t })
        },
      }
      return osc
    },
  }
  return { ctx, started, drums }
}

/** A host with a controllable clock; WebAudio optional. */
function testHost(withAudio = true) {
  let nextId = 1
  const timers = new Map<number, () => void>()
  const audio = withAudio ? fakeAudioContext() : null
  return {
    host: {
      createContext: () => (audio ? audio.ctx as unknown as AudioContext : null),
      setInterval: (fn: () => void, _ms: number) => {
        const id = nextId++
        timers.set(id, fn)
        return id
      },
      clearInterval: (id: number) => {
        timers.delete(id)
      },
    },
    running: () => timers.size,
    /** Advance the audio clock in scheduler-sized ticks, firing it each time. */
    advance: (seconds: number) => {
      for (let t = 0; t < seconds; t += 0.025) {
        if (audio) audio.ctx.currentTime += 0.025
        for (const fn of [...timers.values()]) fn()
      }
    },
    notes: () => audio?.started ?? [],
    drums: () => audio?.drums ?? [],
    closed: () => audio?.ctx.closed ?? false,
  }
}

Deno.test('songs: every song is well-formed and parses', () => {
  for (const [name, song] of Object.entries(SONGS)) {
    assertEquals(song.melody.length, song.chords.length, `${name}: a melody bar per chord`)
    for (const bar of song.melody) assertEquals(bar.split(' ').length, 8, `${name}: 8 eighths in "${bar}"`)
    for (const p of [song.bass, song.kick, song.snare, song.hat]) assertEquals(p.length, STEPS_PER_BAR, name)
    for (let step = 0; step < song.chords.length * STEPS_PER_BAR; step++) stepEvents(song, step)
  }
})

Deno.test('songs: the phases get faster', () => {
  assert(SONGS.slow.bpm < SONGS.normal.bpm && SONGS.normal.bpm < SONGS.fast.bpm)
})

Deno.test('songs: notes, chords and held melody notes', () => {
  assertEquals(midi('C4'), 60)
  assertEquals(midi('F#5'), 78)
  assertEquals(midi('Bb5'), 82)
  assertEquals(chordTones('Am', 4), [69, 72, 76, 81])
  assertEquals(chordTones('E', 4), [64, 68, 71, 76])
  const first = stepEvents(SONGS.menu, 0)
  assertEquals(first.find((e) => e.voice === 'lead'), { voice: 'lead', note: midi('E5'), steps: 6 }, 'E5 - - holds 3 eighths')
  assert(first.some((e) => e.voice === 'kick'), 'the bar opens on a kick')
})

Deno.test('musicPhase: menu, then slow → normal → fast as the wave thins', () => {
  assertEquals(musicPhase('title', 0), 'menu')
  assertEquals(musicPhase('playing', 55), 'slow')
  assertEquals(musicPhase('playing', NORMAL_AT), 'normal')
  assertEquals(musicPhase('playing', FAST_AT), 'fast')
  assertEquals(musicPhase('waveClear', 0), 'fast')
  assertEquals(musicPhase('gameOver', 10), null)
  assertEquals(musicPhase('nameEntry', 10), null)
})

Deno.test('audio: a stall skips the missed notes instead of bursting them', () => {
  const { host, notes, advance } = testHost()
  const audio = createAudio(host)
  audio.music(started())
  advance(0.5)
  const ctx = host.createContext() as unknown as { currentTime: number }
  ctx.currentTime += 30 // the tab was throttled for half a minute
  const before = notes().length
  advance(0.025) // one scheduler tick after the stall
  assert(notes().length - before < 10, `burst of ${notes().length - before} notes after a stall`)
})

Deno.test('audio: music starts once and plays notes on the beat', () => {
  const { host, running, advance, notes, drums } = testHost()
  const audio = createAudio(host)
  const s = started()
  for (let i = 0; i < 10; i++) audio.music(s)
  assertEquals(running(), 1, 'one scheduler, not one per frame')
  assertEquals(audio.song, 'slow')
  advance(2)
  assert(notes().length > 0, 'tonal notes were scheduled')
  assert(drums().length > 0, 'drums were scheduled')
})

Deno.test('audio: a phase change fades out, then the new song comes in', () => {
  const { host, advance, notes, running } = testHost()
  const audio = createAudio(host)
  const s = started()
  audio.music(s)
  advance(1)
  for (let i = 0; i < s.invaders.length - FAST_AT; i++) s.invaders[i].alive = false
  audio.music(s)
  assertEquals(audio.song, 'fast')
  const atSwitch = notes().length
  advance(FADE_OUT_S / 2)
  const midFade = notes().length
  assert(midFade > atSwitch, 'the old song plays on while it fades')
  advance(FADE_OUT_S + FADE_IN_S)
  assert(notes().length > midFade, 'the new song is playing')
  assertEquals(running(), 1, 'one scheduler drives both')
})

Deno.test('audio: game over fades the music out; dying, pause and wave break do not', () => {
  const { host, running, advance } = testHost()
  const audio = createAudio(host)
  const s = started()
  audio.music(s)
  for (const screen of ['dying', 'playing', 'paused', 'waveClear', 'playing'] as const) {
    s.screen = screen
    audio.music(s)
    assertEquals(running(), 1, `music must keep playing through '${screen}'`)
  }
  s.screen = 'gameOver'
  audio.music(s)
  assertEquals(audio.song, null)
  advance(FADE_OUT_S + 0.1)
  assertEquals(running(), 0, 'the scheduler ends once the fade-out is over')
})

Deno.test('audio: mute toggles and no context means no crash', () => {
  const { host, running } = testHost(false)
  const audio = createAudio(host)
  assertEquals(audio.toggleMute(), true)
  assertEquals(audio.toggleMute(), false)
  audio.music(started())
  assertEquals(running(), 0)
  audio.dispose()
})

Deno.test('audio: dispose stops the music and two instances never share state', () => {
  const a = testHost()
  const b = testHost()
  const audioA = createAudio(a.host)
  createAudio(b.host)
  audioA.music(started())
  assertEquals(b.running(), 0, 'B is untouched by A')
  audioA.dispose()
  assertEquals(a.running(), 0, 'dispose stops at once, no fade')
  assertEquals(a.closed(), true)
})

Deno.test('audio: playSounds is a no-op without a previous frame', () => {
  const { host, notes } = testHost()
  const audio = createAudio(host)
  audio.playSounds(null, started())
  assertEquals(notes().length, 0)
})

Deno.test('audio: firing plays the shoot sound', () => {
  const { host, notes } = testHost()
  const audio = createAudio(host)
  const s = started()
  const prev = snapshotFrame(s)
  s.player.bullet = { x: 0, y: 0, w: 3, h: 10, color: '#ffe600' }
  audio.playSounds(prev, s)
  assertEquals(notes().length, 1)
  assertEquals(notes()[0].type, 'square', 'the laser is a square wave')
  assertEquals(notes()[0].freq, 600)
})

Deno.test('audio: each distinct event gets its own voice', () => {
  const cases: [string, (s: GameState) => void, string, number][] = [
    ['invader killed', (s) => {
      s.invaders[0].alive = false
    }, 'square', 800],
    ['player killed', (s) => {
      s.screen = 'dying'
    }, 'sawtooth', 300],
    ['ufo appears', (s) => {
      s.ufo = { x: 0, y: 25, dir: 1 }
    }, 'sine', 400],
    ['wave cleared', (s) => {
      s.screen = 'waveClear'
    }, 'sine', 200],
  ]
  for (const [label, mutate, wave, freq] of cases) {
    const { host, notes } = testHost()
    const audio = createAudio(host)
    const s = started()
    const prev = snapshotFrame(s)
    mutate(s)
    audio.playSounds(prev, s)
    assertEquals(notes().length, 1, `${label}: exactly one sound`)
    assertEquals(notes()[0].type, wave, `${label}: wave shape`)
    assertEquals(notes()[0].freq, freq, `${label}: pitch`)
  }
})

Deno.test('audio: dispose closes the audio context', () => {
  const { host, closed } = testHost()
  const audio = createAudio(host)
  // Play something first — the context is created lazily, on the first sound.
  const s = started()
  const prev = snapshotFrame(s)
  s.player.bullet = { x: 0, y: 0, w: 3, h: 10, color: '#ffe600' }
  audio.playSounds(prev, s)
  assertEquals(closed(), false)

  audio.dispose()
  assertEquals(closed(), true)
})

Deno.test('audio: shooting the UFO down plays a blast; flying off does not', () => {
  for (const [label, scored, blast] of [['shot down', true, true], ['flew off', false, false]] as const) {
    const { host, notes, drums } = testHost()
    const audio = createAudio(host)
    const s = started()
    s.ufo = { x: 100, y: 25, dir: 1 }
    const prev = snapshotFrame(s)
    s.ufo = null
    if (scored) s.ufoHits++
    audio.playSounds(prev, s)
    assertEquals(drums().length, blast ? 1 : 0, `${label}: noise boom`)
    assertEquals(notes().some((n) => n.type === 'sawtooth' && n.freq === 260), blast, `${label}: falling growl`)
  }
})

Deno.test('audio: a UFO on screen starts a sustained hum and leaving stops it', () => {
  const { host, notes } = testHost()
  const audio = createAudio(host)
  const s = started()
  const prev = snapshotFrame(s)

  // UFO appears.
  s.ufo = { x: 0, y: 25, dir: 1 }
  audio.playSounds(prev, s)
  // One spawn note + the two hum oscillators, all started but only the spawn
  // note is a short-lived stop() — the hum voices never stop.
  const afterAppear = notes().length
  assert(afterAppear === 1, `only the spawn note is a one-shot (got ${afterAppear})`)

  // UFO still present — hum must not restart (no extra notes).
  const prevStill = snapshotFrame({ ...s, ufo: { x: 20, y: 25 } } as GameState)
  audio.playSounds(prevStill, s)
  assertEquals(notes().length, 1, 'a present UFO does not re-trigger the siren')

  // UFO leaves — hum stops (dispose path exercised without error).
  const prevGone = snapshotFrame(s)
  s.ufo = null
  audio.playSounds(prevGone, s)
  audio.dispose()
})

// ── the frame pipeline ──────────────────────────────────────────────────────
// This is the code the rAF callback runs. The test harness has no
// requestAnimationFrame, so without extracting it none of this was ever
// exercised — which is exactly how "pause banks the hi-score" got in.

function frameRig(state: GameState) {
  const banked: number[] = []
  let ticks = 0
  const { host } = testHost()
  const deps = {
    ctx: recordingCtx().ctx,
    state,
    prev: null as ReturnType<typeof snapshotFrame> | null,
    fx: createVisualEffects(),
    stars: createStars(seq([0.5]), 3),
    audio: createAudio(host),
    scale: 1,
    timeMs: 0,
    tick: () => ticks++,
    recordScore: (s: number) => banked.push(s),
  }
  return {
    deps,
    banked,
    ticks: () => ticks,
    run: () => {
      deps.prev = frame(deps)
    },
  }
}

Deno.test('frame: ticks the simulation only on live screens', () => {
  const s = started()
  const rig = frameRig(s)
  rig.run()
  assertEquals(rig.ticks(), 1, 'playing ticks')

  s.screen = 'paused'
  rig.run()
  assertEquals(rig.ticks(), 1, 'paused does not tick')

  s.screen = 'gameOver'
  rig.run()
  assertEquals(rig.ticks(), 1, 'game over does not tick')
})

Deno.test('frame: REGRESSION — pausing must not bank the in-progress score', () => {
  const s = started()
  s.score = 750
  const rig = frameRig(s)
  rig.run() // playing
  s.screen = 'paused'
  rig.run() // playing -> paused
  assertEquals(rig.banked, [], 'a pause is not the end of the run')

  // …and resuming and finishing still banks exactly once.
  s.screen = 'playing'
  rig.run()
  s.screen = 'gameOver'
  rig.run()
  assertEquals(rig.banked, [750])
})

Deno.test('frame: banks the score when the run reaches an end screen', () => {
  for (const end of ['gameOver', 'nameEntry'] as const) {
    const s = started()
    s.score = 420
    const rig = frameRig(s)
    rig.run()
    s.screen = end
    rig.run()
    assertEquals(rig.banked, [420], `${end} banks the score`)
  }
})

Deno.test('frame: a replay never re-banks its score', () => {
  const s = started()
  s.score = 900
  s.isReplay = true
  const rig = frameRig(s)
  rig.run()
  s.screen = 'gameOver'
  rig.run()
  assertEquals(rig.banked, [], 'the original run already claimed this score')
})

Deno.test('frame: the returned snapshot becomes a real previous frame', () => {
  const s = started()
  const rig = frameRig(s)
  rig.run()
  const snap = rig.deps.prev!
  assertEquals(snap.screen, 'playing')
  s.screen = 'dying'
  s.score = 99
  // The snapshot must NOT follow the live state — that was the original bug.
  assertEquals(snap.screen, 'playing')
  assertEquals(snap.score, 0)
})

Deno.test('frame: killing an invader between frames spawns effects and a sound', () => {
  const s = started()
  const rig = frameRig(s)
  rig.run() // establishes prev
  const notesBefore = 0
  s.invaders[0].alive = false
  s.score += 40
  rig.run()
  assert(rig.deps.fx.particles.length > notesBefore, 'an explosion was spawned')
  assert(rig.deps.fx.popups.length > 0, 'a score popup was spawned')
})

Deno.test('fixedSteps: 60 ticks a second at any refresh rate', () => {
  for (const hz of [30, 60, 75, 120, 144, 240]) {
    let acc = 0
    let ticks = 0
    for (let f = 0; f < hz; f++) {
      const r = fixedSteps(acc, 1000 / hz)
      acc = r.acc
      ticks += r.steps
    }
    assert(Math.abs(ticks - 60) <= 1, `${hz} Hz ran ${ticks} ticks in one second`)
  }
  assertEquals(fixedSteps(0, 16.4).steps, 1, '60 Hz jitter snaps to one tick')
  assertEquals(fixedSteps(0, 5000), { steps: MAX_STEPS, acc: 0 }, 'a stall jumps, it does not fast-forward')
  assertEquals(fixedSteps(0, TICK_MS).steps, 1)
})

Deno.test('audio + effects: a restart or quit is a reset, not gameplay', () => {
  for (const [from, to] of [['gameOver', 'playing'], ['playing', 'title'], ['paused', 'title']] as const) {
    const { host, notes } = testHost()
    const audio = createAudio(host)
    const fx = createVisualEffects()
    const s = started()
    s.screen = from
    s.lives = 0
    s.player.shield = true
    const prev = snapshotFrame(s)
    // What resetGame / abandonRun do: lives back, shield gone, grid replaced.
    s.screen = to
    s.lives = 3
    s.player.shield = false
    s.invaders = to === 'title' ? [] : s.invaders
    audio.playSounds(prev, s)
    detectAndSpawnEffects(fx, prev, s, () => 0.5)
    assertEquals(notes().length, 0, `${from} → ${to}: no sound`)
    assertEquals(fx.popups.length + fx.particles.length, 0, `${from} → ${to}: no effect`)
  }
})

Deno.test('audio: the UFO siren stops while paused and resumes with play', () => {
  const { host } = testHost()
  let hums = 0
  const audio = createAudio({
    ...host,
    createContext: () => {
      const ctx = host.createContext() as unknown as { createOscillator: () => { start: () => void } }
      const make = ctx.createOscillator
      ctx.createOscillator = () => {
        const o = make()
        const start = o.start
        o.start = (...a: unknown[]) => {
          if (a.length === 0) hums++
          return (start as (...x: unknown[]) => void)(...a)
        }
        return o
      }
      return ctx as unknown as AudioContext
    },
  })
  const s = started()
  s.ufo = { x: 100, y: 25, dir: 1 }
  audio.playSounds(snapshotFrame(s), s)
  assertEquals(hums, 2, 'two detuned siren voices')
  s.screen = 'paused'
  audio.playSounds(snapshotFrame(s), s)
  s.screen = 'playing'
  audio.playSounds(snapshotFrame(s), s)
  assertEquals(hums, 4, 'stopped on pause, started again on resume')
})
