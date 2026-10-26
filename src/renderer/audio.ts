import type { GameState } from '../features/game/types.ts'
import { type FrameSnapshot, sameRun } from './snapshot.ts'
import { freq, SONGS, type SongName, stepEvents, type Voice, type Wave } from './songs.ts'

export type SoundName =
  | 'shoot'
  | 'invaderDie'
  | 'playerDie'
  | 'ufo'
  | 'wave'
  | 'extraLife'
  | 'powerUp'
  | 'shieldPop'
  | 'powerSpawn'

/** One oscillator envelope per arcade sound. Data, not control flow, so the
 *  whole SFX bank is one table you can read at a glance. */
const SOUNDS: Record<SoundName, {
  wave: OscillatorType
  from: number
  to: number
  ramp: 'exp' | 'lin'
  gain: number
  dur: number
  hold?: number
}> = {
  shoot: { wave: 'square', from: 600, to: 200, ramp: 'exp', gain: 0.08, dur: 0.1 },
  invaderDie: { wave: 'square', from: 800, to: 100, ramp: 'exp', gain: 0.1, dur: 0.2 },
  playerDie: { wave: 'sawtooth', from: 300, to: 50, ramp: 'exp', gain: 0.12, dur: 0.6 },
  ufo: { wave: 'sine', from: 400, to: 500, ramp: 'lin', gain: 0.06, dur: 0.3, hold: 0.15 },
  wave: { wave: 'sine', from: 200, to: 1000, ramp: 'exp', gain: 0.08, dur: 0.5, hold: 0.4 },
  extraLife: { wave: 'square', from: 523, to: 1568, ramp: 'exp', gain: 0.09, dur: 0.7, hold: 0.5 },
  powerUp: { wave: 'square', from: 440, to: 1760, ramp: 'exp', gain: 0.08, dur: 0.35, hold: 0.3 },
  shieldPop: { wave: 'triangle', from: 900, to: 200, ramp: 'exp', gain: 0.12, dur: 0.25 },
  powerSpawn: { wave: 'sine', from: 1200, to: 1800, ramp: 'lin', gain: 0.05, dur: 0.12 },
}

// ── Music — a tiny tracker playing the note data in songs.ts ───────────────
/** Invaders left when the wave moves into the normal and fast phases. */
export const NORMAL_AT = 36
export const FAST_AT = 8
/** Background level — the SFX must always win. */
export const MUSIC_VOLUME = 0.2
/** Volume while paused — a duck, not a stop, so resuming is seamless. */
export const PAUSED_VOLUME = 0.05
/** Notes are scheduled this far ahead on the audio clock, so timer jitter
 *  never reaches the beat (the standard Web Audio lookahead pattern). */
export const LOOKAHEAD_S = 0.12
export const SCHEDULER_MS = 25
/** A song change fades the old song to silence, then fades the new one in. */
export const FADE_OUT_S = 1.5
export const FADE_IN_S = 1

/** Which song the game calls for. Pure: the whole music policy at a glance.
 *  Each wave starts slow, turns into a groove, and races at the last aliens. */
export function musicPhase(screen: GameState['screen'], alive: number): SongName | null {
  if (screen === 'gameOver' || screen === 'nameEntry') return null
  if (screen === 'title') return 'menu'
  if (alive <= FAST_AT) return 'fast'
  if (alive <= NORMAL_AT) return 'normal'
  return 'slow'
}

/** Per-voice level and envelope. Data, like the SFX table. */
const VOICES: Record<Exclude<Voice, 'kick' | 'snare' | 'hat'>, { gain: number; release: number }> = {
  lead: { gain: 0.32, release: 0.9 },
  arp: { gain: 0.1, release: 0.5 },
  bass: { gain: 0.3, release: 0.8 },
}

/** Injectable so tests drive the sequencer without real timers or WebAudio. */
export type AudioHost = {
  createContext: () => AudioContext | null
  setInterval: (fn: () => void, ms: number) => number
  clearInterval: (id: number) => void
}

const defaultHost: AudioHost = {
  createContext: () => {
    // deno-lint-ignore no-explicit-any
    const Ctor = globalThis.AudioContext ?? (globalThis as Record<string, any>).webkitAudioContext
    return Ctor ? new Ctor() : null
  },
  setInterval: (fn, ms) => setInterval(fn, ms) as unknown as number,
  clearInterval: (id) => clearInterval(id),
}

export type Audio = {
  /** Play the sounds implied by the change from `prev` to `next`. */
  playSounds(prev: FrameSnapshot | null, next: GameState): void
  /** Follow the game with the right song and volume. Call every frame. */
  music(next: GameState): void
  /** Music on/off (M). Returns the new muted state. */
  toggleMute(): boolean
  /** Resume a context the browser created suspended — call from a key press. */
  unlock(): void
  /** Stop everything and close the context. Call on unmount. */
  dispose(): void
  /** The song playing now, null when silent. */
  readonly song: SongName | null
}

/** All audio state lives inside this closure: no module-level `AudioContext`.
 *  Two instances never fight, and `dispose()` genuinely stops everything. */
export function createAudio(host: AudioHost = defaultHost): Audio {
  let ctx: AudioContext | null = null
  let musicBus: GainNode | null = null
  let noise: AudioBuffer | null = null
  let pulse: PeriodicWave | null = null
  let muted = false
  let volume = -1
  let timer: number | null = null
  // Songs being sequenced: the current one last, any fading-out ones before
  // it. Each has its own gain, so a change is a fade, not a cut.
  type Track = { song: SongName; step: number; at: number; gain: GainNode; until: number }
  let tracks: Track[] = []
  let want: SongName | null = null
  // The UFO's continuous siren: detuned oscillators through one gain, kept
  // alive for as long as the saucer is on screen (game/script.js:701 — the
  // original re-fires the note each frame the UFO is present).
  let ufoHum: { oscs: OscillatorNode[]; gain: GainNode } | null = null

  const ensure = (): AudioContext | null => {
    if (!ctx) ctx = host.createContext()
    return ctx
  }

  const bus = (ac: AudioContext): GainNode => {
    if (!musicBus) {
      musicBus = ac.createGain()
      musicBus.gain.value = 0
      musicBus.connect(ac.destination)
    }
    return musicBus
  }

  /** The NES 25% pulse — the classic chiptune lead. */
  const setWave = (ac: AudioContext, osc: OscillatorNode, wave: Wave) => {
    if (wave !== 'pulse' || !ac.createPeriodicWave) {
      osc.type = wave === 'pulse' ? 'square' : wave
      return
    }
    if (!pulse) {
      const n = 32
      const real = new Float32Array(n)
      const imag = new Float32Array(n)
      for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25)
      pulse = ac.createPeriodicWave(real, imag)
    }
    osc.setPeriodicWave(pulse)
  }

  const tonal = (ac: AudioContext, out: AudioNode, voice: keyof typeof VOICES, wave: Wave, note: number, t: number, dur: number) => {
    const v = VOICES[voice]
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    setWave(ac, osc, wave)
    osc.frequency.value = freq(note)
    osc.connect(gain)
    gain.connect(out)
    const end = t + dur * v.release
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(v.gain, t + 0.005)
    gain.gain.exponentialRampToValueAtTime(v.gain * 0.6, t + Math.min(0.08, dur / 2))
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    osc.start(t)
    osc.stop(end + 0.01)
  }

  /** White noise, shared by the drums and the UFO blast. */
  const noiseBuffer = (ac: AudioContext): AudioBuffer => {
    if (!noise) {
      noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.8), ac.sampleRate)
      const data = noise.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    }
    return noise
  }

  /** Noise through a filter, with a decaying gain. */
  const noiseHit = (
    ac: AudioContext,
    out: AudioNode,
    t: number,
    f: { type: BiquadFilterType; from: number; to?: number },
    peak: number,
    len: number,
  ) => {
    const src = ac.createBufferSource()
    const filter = ac.createBiquadFilter()
    const gain = ac.createGain()
    src.buffer = noiseBuffer(ac)
    filter.type = f.type
    filter.frequency.setValueAtTime(f.from, t)
    if (f.to) filter.frequency.exponentialRampToValueAtTime(f.to, t + len)
    src.connect(filter)
    filter.connect(gain)
    gain.connect(out)
    gain.gain.setValueAtTime(peak, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + len)
    src.start(t)
    src.stop(t + len + 0.01)
  }

  const drum = (ac: AudioContext, out: AudioNode, voice: 'kick' | 'snare' | 'hat', t: number) => {
    if (voice === 'hat') return noiseHit(ac, out, t, { type: 'highpass', from: 7000 }, 0.07, 0.04)
    if (voice === 'snare') return noiseHit(ac, out, t, { type: 'highpass', from: 1200 }, 0.3, 0.14)
    // Kick: a sine diving from 150 to 40 Hz.
    const gain = ac.createGain()
    const osc = ac.createOscillator()
    gain.connect(out)
    osc.frequency.setValueAtTime(150, t)
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12)
    osc.connect(gain)
    gain.gain.setValueAtTime(0.7, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    osc.start(t)
    osc.stop(t + 0.2)
  }

  /** Schedule every step that falls inside the lookahead window. */
  const schedule = () => {
    const ac = ctx
    if (!ac) return
    tracks = tracks.filter((tr) => {
      if (tr.until > ac.currentTime) return true
      tr.gain.disconnect()
      return false
    })
    if (!tracks.length) return stopTimer()
    for (const tr of tracks) {
      const song = SONGS[tr.song]
      const stepS = 60 / song.bpm / 4
      // After a stall (a busy main thread, a throttled background tab) the
      // missed steps are skipped, not crammed into one burst.
      if (tr.at < ac.currentTime) {
        const missed = Math.ceil((ac.currentTime - tr.at) / stepS)
        tr.at += missed * stepS
        tr.step += missed
      }
      while (tr.at < Math.min(tr.until, ac.currentTime + LOOKAHEAD_S)) {
        for (const e of stepEvents(song, tr.step)) {
          if (e.voice === 'kick' || e.voice === 'snare' || e.voice === 'hat') drum(ac, tr.gain, e.voice, tr.at)
          else {
            const wave = e.voice === 'lead' ? song.lead : e.voice === 'bass' ? song.bassWave : 'square'
            tonal(ac, tr.gain, e.voice, wave, e.note, tr.at, e.steps * stepS)
          }
        }
        tr.at += stepS
        tr.step++
      }
    }
  }

  const stopTimer = () => {
    if (timer !== null) host.clearInterval(timer)
    timer = null
  }

  /** Fade the current song out; then, if asked, fade the new one in. */
  const switchTo = (song: SongName | null) => {
    want = song
    const ac = song ? ensure() : ctx
    if (!ac) return
    const now = ac.currentTime
    const current = tracks.at(-1)
    if (current && current.until === Infinity) {
      current.gain.gain.cancelScheduledValues(now)
      current.gain.gain.setValueAtTime(current.gain.gain.value, now)
      current.gain.gain.linearRampToValueAtTime(0, now + FADE_OUT_S)
      current.until = now + FADE_OUT_S
    }
    if (song) {
      const gain = ac.createGain()
      gain.connect(bus(ac))
      // The first song starts at once; a later one waits for the silence.
      const start = now + (current ? FADE_OUT_S : 0.05)
      gain.gain.setValueAtTime(0, now)
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(1, start + (current ? FADE_IN_S : 0.05))
      tracks.push({ song, step: 0, at: start, gain, until: Infinity })
    }
    if (timer === null && tracks.length) timer = host.setInterval(schedule, SCHEDULER_MS)
    schedule()
  }

  const play = (name: SoundName) => {
    const ac = ensure()
    if (!ac) return
    const spec = SOUNDS[name]
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.connect(gain)
    gain.connect(ac.destination)
    const t = ac.currentTime
    osc.type = spec.wave
    osc.frequency.setValueAtTime(spec.from, t)
    const peakAt = t + (spec.hold ?? spec.dur)
    if (spec.ramp === 'exp') osc.frequency.exponentialRampToValueAtTime(spec.to, peakAt)
    else osc.frequency.linearRampToValueAtTime(spec.to, peakAt)
    // The UFO hum slides back down; every other sound just decays.
    if (name === 'ufo') osc.frequency.linearRampToValueAtTime(spec.from, t + spec.dur)
    gain.gain.setValueAtTime(spec.gain, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + spec.dur)
    osc.start(t)
    osc.stop(t + spec.dur)
  }

  /** The saucer going down: a filtered-noise boom under a falling growl. */
  const ufoBlast = () => {
    const ac = ensure()
    if (!ac) return
    const t = ac.currentTime
    noiseHit(ac, ac.destination, t, { type: 'lowpass', from: 4000, to: 150 }, 0.35, 0.7)
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(260, t)
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.6)
    osc.connect(gain)
    gain.connect(ac.destination)
    gain.gain.setValueAtTime(0.14, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
    osc.start(t)
    osc.stop(t + 0.62)
  }

  /** Start the UFO siren — two slightly-detuned oscillators through one gain, so
   *  it sounds like a wail, not a pure sine. Idempotent. */
  const startUfoHum = () => {
    const ac = ensure()
    if (!ac || ufoHum) return
    const gain = ac.createGain()
    gain.connect(ac.destination)
    gain.gain.value = 0.05
    const oscs: OscillatorNode[] = []
    for (const detune of [-14, 14]) {
      const osc = ac.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = 400
      osc.detune.value = detune
      osc.connect(gain)
      osc.start()
      oscs.push(osc)
    }
    ufoHum = { gain, oscs }
  }

  const stopUfoHum = () => {
    if (!ufoHum) return
    for (const osc of ufoHum.oscs) {
      try {
        osc.stop()
      } catch { /* already stopped */ }
    }
    ufoHum.gain.disconnect()
    ufoHum = null
  }

  return {
    playSounds(prev, next) {
      // The siren follows the saucer, but only while the game is live —
      // never over the pause card or the game-over screen.
      if (next.ufo && (next.screen === 'playing' || next.screen === 'dying')) startUfoHum()
      else stopUfoHum()
      if (!prev || !sameRun(prev, next)) return
      if (!prev.hasPlayerBullet && next.player.bullet) play('shoot')
      const nextAlive = next.invaders.reduce((n, i) => n + (i.alive ? 1 : 0), 0)
      if (nextAlive < prev.aliveCount) play('invaderDie')
      if (prev.screen === 'playing' && next.screen === 'dying') play('playerDie')
      if (!prev.ufo && next.ufo) play('ufo')
      if (next.ufoHits > prev.ufoHits) ufoBlast()
      if (prev.screen !== 'waveClear' && next.screen === 'waveClear') play('wave')
      if (prev.screen === 'waveClear' && next.screen === 'playing') play('wave')
      if (next.lives > prev.lives) play('extraLife')
      if (next.player.rapid > prev.rapid || next.player.triple > prev.triple || (next.player.shield && !prev.shield)) {
        play('powerUp')
      }
      if (prev.shield && !next.player.shield && prev.screen === 'playing') play('shieldPop')
      if (!prev.hasPowerUp && next.powerUp) play('powerSpawn')
    },
    music(next) {
      let alive = 0
      for (const inv of next.invaders) if (inv.alive) alive++
      const song = musicPhase(next.screen, alive)
      if (song !== want) switchTo(song)
      const ac = ctx
      if (!ac) return
      // The bus is touched only on change — a ramp per frame would pile up.
      const v = muted ? 0 : next.screen === 'paused' ? PAUSED_VOLUME : MUSIC_VOLUME
      if (v !== volume) {
        volume = v
        const g = bus(ac).gain
        g.cancelScheduledValues(ac.currentTime)
        g.setValueAtTime(g.value, ac.currentTime)
        g.linearRampToValueAtTime(v, ac.currentTime + 0.25)
      }
    },
    toggleMute() {
      muted = !muted
      return muted
    },
    unlock() {
      if (ensure()?.state === 'suspended') ctx?.resume()
    },
    dispose() {
      stopUfoHum()
      stopTimer()
      tracks = []
      want = null
      ctx?.close?.()
      ctx = null
      musicBus = null
      // Nodes cached from the closed context are useless to a new one.
      noise = null
      pulse = null
      volume = -1
    },
    get song() {
      return want
    },
  }
}
