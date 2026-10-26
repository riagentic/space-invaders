/** The soundtrack, written like a MIDI/tracker file: notes, not audio.
 *
 *  16 steps per bar (16th notes). Melodies are written in 8th notes — a note
 *  name, `-` to hold the previous note, `.` for a rest. Bass and drum patterns
 *  are 16 steps: bass `R` root, `O` octave up; drums `x` hit. Arpeggios are
 *  derived from the chords, so harmony lives in exactly one place. */

export type SongName = 'menu' | 'slow' | 'normal' | 'fast'
export type Voice = 'lead' | 'arp' | 'bass' | 'kick' | 'snare' | 'hat'
export type Wave = 'pulse' | 'square' | 'triangle'

export type Song = {
  bpm: number
  /** One chord per bar: root + optional `m`. */
  chords: string[]
  /** One bar per entry, 8 space-separated 8th-note tokens. */
  melody: string[]
  lead: Wave
  bass: string
  bassWave: Wave
  /** Arpeggio note every N steps; 0 = no arpeggio. */
  arpEvery: 0 | 1 | 2
  kick: string
  snare: string
  hat: string
}

export const STEPS_PER_BAR = 16

export const SONGS: Record<SongName, Song> = {
  // Title theme — heroic, mid-tempo. Am F C G.
  menu: {
    bpm: 112,
    chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'],
    melody: [
      'E5 - - D5 C5 - B4 C5',
      'A4 - - - . . C5 D5',
      'E5 - G5 - E5 - D5 C5',
      'D5 - - - . . B4 D5',
      'E5 - - D5 C5 - B4 C5',
      'A4 - C5 - F5 - E5 D5',
      'E5 - D5 - C5 - G4 -',
      'B4 - D5 - G5 - - -',
    ],
    lead: 'pulse',
    bass: 'R...R.O.R...R.O.',
    bassWave: 'triangle',
    arpEvery: 2,
    kick: 'x.......x.......',
    snare: '....x.......x...',
    hat: '..x...x...x...x.',
  },
  // Phase 1 — calm and spacious, half-time beat. Dm Bb F C.
  slow: {
    bpm: 96,
    chords: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'F', 'C'],
    melody: [
      'D5 - - - F5 - A5 -',
      'G5 - - - F5 - D5 -',
      'C5 - - - F5 - A5 -',
      'G5 - - - E5 - - -',
      'D5 - F5 - A5 - D6 -',
      'C6 - Bb5 - A5 - F5 -',
      'A5 - - - G5 - F5 -',
      'E5 - - - - - . .',
    ],
    lead: 'triangle',
    bass: 'R.......R...O...',
    bassWave: 'triangle',
    arpEvery: 2,
    kick: 'x.........x.....',
    snare: '........x.......',
    hat: 'x...x...x...x...',
  },
  // Phase 2 — four-on-the-floor dance groove. Em C G D.
  normal: {
    bpm: 124,
    chords: ['Em', 'C', 'G', 'D', 'Em', 'C', 'G', 'D'],
    melody: [
      'B4 . E5 . G5 . F#5 E5',
      'G5 - E5 . C5 . E5 .',
      'D5 . G5 . B5 . A5 G5',
      'F#5 - - . D5 . A4 .',
      'B4 . E5 . G5 . B5 .',
      'C6 - B5 . G5 . E5 .',
      'D5 . G5 . B5 . D6 .',
      'A5 - F#5 . D5 . F#5 .',
    ],
    lead: 'pulse',
    bass: 'R.O.R.O.R.O.R.O.',
    bassWave: 'square',
    arpEvery: 1,
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    hat: '..x...x...x...x.',
  },
  // Phase 3 — the last aliens: fastest, driving octave bass. Am G F E.
  fast: {
    bpm: 150,
    chords: ['Am', 'G', 'F', 'E', 'Am', 'G', 'F', 'E'],
    melody: [
      'A5 . A5 . C6 . A5 .',
      'B5 . G5 . D5 . G5 .',
      'C6 . A5 . F5 . A5 .',
      'B5 - G#5 - E5 - G#5 -',
      'E6 . D6 . C6 . B5 .',
      'D6 . B5 . G5 . B5 .',
      'A5 . C6 . F6 . E6 .',
      'E6 - - - G#5 - B5 -',
    ],
    lead: 'square',
    bass: 'RORORORORORORORO',
    bassWave: 'square',
    arpEvery: 1,
    kick: 'x...x...x...x...',
    snare: '....x.......x.xx',
    hat: 'xxxxxxxxxxxxxxxx',
  },
}

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** `C4` → 60. Throws on a malformed name — a typo in a song is a bug. */
export function midi(name: string): number {
  const m = /^([A-G])(#|b)?(\d)$/.exec(name)
  if (!m) throw new Error(`bad note "${name}"`)
  return 12 * (Number(m[3]) + 1) + PITCH[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)
}

/** `Am` → [A, C, E, A'] as MIDI notes, rooted at `octave`. */
export function chordTones(chord: string, octave: number): number[] {
  const m = /^([A-G][#b]?)(m?)$/.exec(chord)
  if (!m) throw new Error(`bad chord "${chord}"`)
  const root = midi(`${m[1]}${octave}`)
  return [root, root + (m[2] ? 3 : 4), root + 7, root + 12]
}

export const freq = (note: number): number => 440 * 2 ** ((note - 69) / 12)

export type NoteEvent = { voice: Voice; note: number; steps: number }

/** Every note that starts on `step` of `song` (looping). Pure. */
export function stepEvents(song: Song, step: number): NoteEvent[] {
  const bars = song.chords.length
  const bar = Math.floor(step / STEPS_PER_BAR) % bars
  const s = step % STEPS_PER_BAR
  const out: NoteEvent[] = []

  if (s % 2 === 0) {
    const tokens = song.melody[bar].split(' ')
    const i = s / 2
    if (tokens[i] !== '.' && tokens[i] !== '-') {
      let len = 1
      while (tokens[i + len] === '-') len++
      out.push({ voice: 'lead', note: midi(tokens[i]), steps: len * 2 })
    }
  }

  if (song.arpEvery && s % song.arpEvery === 0) {
    const tones = chordTones(song.chords[bar], 4)
    out.push({ voice: 'arp', note: tones[(s / song.arpEvery) % tones.length], steps: song.arpEvery })
  }

  const b = song.bass[s]
  if (b !== '.') {
    let len = 1
    while (s + len < STEPS_PER_BAR && song.bass[s + len] === '.') len++
    out.push({ voice: 'bass', note: chordTones(song.chords[bar], 2)[0] + (b === 'O' ? 12 : 0), steps: len })
  }

  for (const voice of ['kick', 'snare', 'hat'] as const) {
    if (song[voice][s] === 'x') out.push({ voice, note: 0, steps: 1 })
  }
  return out
}
