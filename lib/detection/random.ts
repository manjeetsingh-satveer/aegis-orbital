/**
 * Deterministic PRNG (mulberry32).
 *
 * The detector must be reproducible: the same seed and the same training data
 * have to produce the same forest, otherwise the evaluation numbers cannot be
 * verified and test failures are not reproducible.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform integer in [min, max). */
  nextInt(min: number, max: number): number
  /** Uniform float in [min, max). */
  nextFloat(min: number, max: number): number
  /** Standard normal, via Box-Muller. */
  nextGaussian(): number
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0
  // A zero seed degenerates mulberry32; nudge it off zero.
  if (state === 0) state = 0x9e3779b9

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }

  let spare: number | null = null

  return {
    next,
    nextInt(min: number, max: number): number {
      if (max <= min) return min
      return min + Math.floor(next() * (max - min))
    },
    nextFloat(min: number, max: number): number {
      return min + next() * (max - min)
    },
    nextGaussian(): number {
      if (spare !== null) {
        const value = spare
        spare = null
        return value
      }
      // Reject u === 0 so log() stays finite.
      let u = next()
      while (u === 0) u = next()
      const v = next()
      const magnitude = Math.sqrt(-2 * Math.log(u))
      spare = magnitude * Math.sin(2 * Math.PI * v)
      return magnitude * Math.cos(2 * Math.PI * v)
    },
  }
}

/** Fisher-Yates sample of `count` items without replacement. */
export function sampleWithoutReplacement<T>(items: readonly T[], count: number, rng: Rng): T[] {
  const take = Math.min(count, items.length)
  const pool = items.slice()
  for (let i = 0; i < take; i += 1) {
    const j = rng.nextInt(i, pool.length)
    const a = pool[i]
    const b = pool[j]
    if (a === undefined || b === undefined) continue
    pool[i] = b
    pool[j] = a
  }
  return pool.slice(0, take)
}
