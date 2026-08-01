import { describe, expect, it } from 'vitest'
import { expectedPathLength, IsolationForest } from './isolation-forest'
import { createRng } from './random'
import { generateAttack, generateNominal, toFeatureVector, ATTACK_KINDS } from './telemetry'

describe('expectedPathLength', () => {
  // c(n) = 2H(n-1) - 2(n-1)/n, the normalisation from Liu et al. (2008).
  it('is zero for degenerate sizes', () => {
    expect(expectedPathLength(0)).toBe(0)
    expect(expectedPathLength(1)).toBe(0)
  })

  it('is exactly 1 for two points', () => {
    expect(expectedPathLength(2)).toBe(1)
  })

  it('grows logarithmically', () => {
    const c10 = expectedPathLength(10)
    const c100 = expectedPathLength(100)
    const c1000 = expectedPathLength(1000)
    expect(c100).toBeGreaterThan(c10)
    expect(c1000).toBeGreaterThan(c100)
    // Logarithmic, not linear: the step from 100->1000 is not 10x the value.
    expect(c1000).toBeLessThan(c100 * 2)
  })

  it('matches the published value for n=256', () => {
    // 2 * (ln(255) + gamma) - 2*255/256
    expect(expectedPathLength(256)).toBeCloseTo(10.244, 2)
  })
})

describe('IsolationForest', () => {
  const rng = createRng(7)

  it('rejects invalid construction parameters', () => {
    expect(() => new IsolationForest({ numTrees: 0 })).toThrow(RangeError)
    expect(() => new IsolationForest({ sampleSize: 1 })).toThrow(RangeError)
  })

  it('refuses to score before being fitted', () => {
    expect(() => new IsolationForest().scoreOne([1, 2, 3])).toThrow(/fitted/)
  })

  it('rejects empty and ragged training data', () => {
    expect(() => new IsolationForest().fit([])).toThrow(RangeError)
    expect(() => new IsolationForest().fit([[1, 2], [3]])).toThrow(/inconsistent feature count/)
  })

  it('rejects scoring vectors of the wrong width', () => {
    const forest = new IsolationForest({ numTrees: 8, sampleSize: 16 }).fit(
      Array.from({ length: 40 }, () => [rng.next(), rng.next()]),
    )
    expect(() => forest.scoreOne([1, 2, 3])).toThrow(/expected 2 features/)
  })

  it('produces scores bounded in [0, 1]', () => {
    const data = Array.from({ length: 300 }, () => [rng.nextGaussian(), rng.nextGaussian()])
    const forest = new IsolationForest({ numTrees: 32, sampleSize: 64 }).fit(data)
    for (const score of forest.score(data)) {
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }
  })

  it('is deterministic for a fixed seed', () => {
    const data = Array.from({ length: 200 }, () => [rng.nextGaussian(), rng.nextGaussian()])
    const point = [8, 8]
    const a = new IsolationForest({ seed: 99, numTrees: 32, sampleSize: 64 }).fit(data).scoreOne(point)
    const b = new IsolationForest({ seed: 99, numTrees: 32, sampleSize: 64 }).fit(data).scoreOne(point)
    expect(a).toBe(b)
  })

  // The core property: a point far outside the training manifold isolates
  // faster, so it must score higher than points drawn from the training
  // distribution. This is what the legacy z-score implementation only imitated.
  it('scores a far outlier above dense-cluster points', () => {
    const clusterRng = createRng(11)
    const data = Array.from({ length: 500 }, () => [
      clusterRng.nextGaussian(),
      clusterRng.nextGaussian(),
    ])
    const forest = new IsolationForest({ numTrees: 128, sampleSize: 256, seed: 5 }).fit(data)

    const outlierScore = forest.scoreOne([14, -14])
    const clusterScores = data.map((point) => forest.scoreOne(point))
    const meanCluster = clusterScores.reduce((sum, s) => sum + s, 0) / clusterScores.length

    expect(outlierScore).toBeGreaterThan(meanCluster)
    expect(outlierScore).toBeGreaterThan(0.65)
  })

  it('handles constant features without dividing by zero', () => {
    const data = Array.from({ length: 100 }, () => [1, 1, 1])
    const forest = new IsolationForest({ numTrees: 16, sampleSize: 32 }).fit(data)
    const score = forest.scoreOne([1, 1, 1])
    expect(Number.isFinite(score)).toBe(true)
  })

  it('reports its configuration', () => {
    const forest = new IsolationForest({ numTrees: 16, sampleSize: 32, seed: 3 }).fit(
      Array.from({ length: 50 }, () => [rng.next(), rng.next()]),
    )
    expect(forest.summary).toMatchObject({ numTrees: 16, sampleSize: 32, numFeatures: 2, seed: 3 })
    expect(forest.isFitted).toBe(true)
  })
})

describe('detection on simulated telemetry', () => {
  // Trained on nominal traffic only, every attack class should score above the
  // nominal mean. This is the end-to-end behaviour the product depends on.
  it('separates each attack class from nominal traffic', () => {
    const trainRng = createRng(21)
    const training = Array.from({ length: 2000 }, () => toFeatureVector(generateNominal(trainRng)))
    const forest = new IsolationForest({ numTrees: 128, sampleSize: 256, seed: 42 }).fit(training)

    const evalRng = createRng(84)
    const nominalScores = Array.from({ length: 400 }, () =>
      forest.scoreOne(toFeatureVector(generateNominal(evalRng))),
    )
    const nominalMean = nominalScores.reduce((sum, s) => sum + s, 0) / nominalScores.length

    for (const kind of ATTACK_KINDS) {
      const attackScores = Array.from({ length: 400 }, () =>
        forest.scoreOne(toFeatureVector(generateAttack(kind, evalRng))),
      )
      const attackMean = attackScores.reduce((sum, s) => sum + s, 0) / attackScores.length
      expect(attackMean, `${kind} should score above nominal`).toBeGreaterThan(nominalMean)
    }
  })
})
