/** xorshift32 — deterministic PRNG. Mutates draft seed in-place for Immer compatibility. */
export function nextRandom(state: { rngSeed: number }): number {
  let s = state.rngSeed
  s ^= s << 13
  s ^= s >> 17
  s ^= s << 5
  state.rngSeed = s
  return (s >>> 0) / 0xFFFFFFFF
}
