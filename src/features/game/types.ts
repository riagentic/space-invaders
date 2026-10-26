export type Screen = 'title' | 'playing' | 'paused' | 'dying' | 'waveClear' | 'gameOver' | 'nameEntry'

export type Invader = {
  x: number
  y: number
  type: number
  color: string
  points: number
  alive: boolean
  row: number
  col: number
}

export type Bullet = {
  x: number
  y: number
  w: number
  h: number
  color: string
  /** Sideways drift per frame — only the triple shot's side shots have it. */
  vx?: number
}

export type PowerKind = 'rapid' | 'triple' | 'shield' | 'life'

/** A falling capsule dropped by a killed invader; catch it with the cannon. */
export type PowerUp = { x: number; y: number; kind: PowerKind }

export type Ufo = {
  x: number
  y: number
  dir: number
}

export type ShieldPixel = {
  x: number
  y: number
  w: number
  h: number
  alive: boolean
}

export type InputKey = 'left' | 'right' | 'shoot'

export type InputState = Record<InputKey, boolean>

/** One recorded input change, stamped with the frame it takes effect on. */
export type ReplayEvent = { frame: number; key: InputKey; down: boolean }

/** A whole game, replayable: the seed plus every input change. Because the
 *  simulation is a pure function of (seed, inputs), re-running the tape
 *  reproduces the game exactly — a few dozen events instead of a state log. */
export type ReplayTape = { seed: number; events: ReplayEvent[] }

export type GameState = {
  screen: Screen
  score: number
  lives: number
  wave: number

  player: {
    x: number
    y: number
    w: number
    h: number
    speed: number
    bullet: Bullet | null
    /** The triple shot's two side shots. */
    spread: Bullet[]
    invincible: number
    /** Frames of rapid fire / triple shot left. */
    rapid: number
    triple: number
    /** Absorbs the next hit. */
    shield: boolean
  }

  powerUp: PowerUp | null

  invaders: Invader[]
  invaderDir: number
  invaderFrame: number
  invaderMoveTimer: number
  invaderMoveInterval: number
  invaderShootChance: number
  invaderBullets: Bullet[]

  shields: ShieldPixel[][]

  ufo: Ufo | null
  ufoTimer: number
  /** UFOs shot down this run — lets the renderer tell a kill from a fly-off. */
  ufoHits: number

  input: InputState

  rngSeed: number

  dyingTimer: number
  waveClearTimer: number

  /** Frames simulated in the current game — the replay tape's time base. */
  frameNo: number
  /** Input tape recorded for the game in progress. */
  tape: ReplayTape
  /** The last *played* game's tape, frozen at game over. Null until then. */
  lastReplay: ReplayTape | null
  /** True while re-playing `lastReplay`: live input is ignored and nothing is
   *  recorded, so watching a replay never overwrites the thing being watched. */
  isReplay: boolean
  /** Events already applied from `lastReplay` during a replay. */
  replayCursor: number

  /** Score to beat for a leaderboard slot. Kept in sync from the `scores` cell
   *  by the root component, so the end-of-game branch stays a local decision. */
  qualifyThreshold: number
  /** 4-char arcade name being typed on the name-entry screen. */
  nameEntry: string
  /** The once-per-run bonus cannon has been granted. */
  extraLifeAwarded: boolean
}
