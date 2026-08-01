import { describe, expect, it } from 'vitest'
import { bestF1Threshold, classificationMetrics, confusionMatrix, quantile, rocAuc } from './metrics'

describe('confusionMatrix', () => {
  it('counts each cell', () => {
    const labels = [true, true, false, false, true]
    const predictions = [true, false, true, false, true]
    expect(confusionMatrix(labels, predictions)).toEqual({
      truePositives: 2,
      falseNegatives: 1,
      falsePositives: 1,
      trueNegatives: 1,
    })
  })

  it('rejects mismatched lengths', () => {
    expect(() => confusionMatrix([true], [true, false])).toThrow(RangeError)
  })
})

describe('classificationMetrics', () => {
  it('computes a perfect classifier', () => {
    const labels = [true, false, true, false]
    const metrics = classificationMetrics(labels, labels)
    expect(metrics.accuracy).toBe(1)
    expect(metrics.precision).toBe(1)
    expect(metrics.recall).toBe(1)
    expect(metrics.f1).toBe(1)
    expect(metrics.falsePositiveRate).toBe(0)
  })

  it('computes a classifier that flags everything', () => {
    const labels = [true, false, false, false]
    const metrics = classificationMetrics(labels, [true, true, true, true])
    expect(metrics.recall).toBe(1)
    expect(metrics.precision).toBe(0.25)
    expect(metrics.specificity).toBe(0)
    expect(metrics.falsePositiveRate).toBe(1)
  })

  it('returns zero rather than NaN when a denominator is empty', () => {
    const metrics = classificationMetrics([false, false], [false, false])
    expect(metrics.precision).toBe(0)
    expect(metrics.recall).toBe(0)
    expect(metrics.f1).toBe(0)
    expect(metrics.accuracy).toBe(1)
  })
})

describe('rocAuc', () => {
  it('is 1 for perfectly ranked scores', () => {
    expect(rocAuc([false, false, true, true], [0.1, 0.2, 0.8, 0.9])).toBe(1)
  })

  it('is 0 for perfectly inverted scores', () => {
    expect(rocAuc([true, true, false, false], [0.1, 0.2, 0.8, 0.9])).toBe(0)
  })

  it('is 0.5 when every score ties', () => {
    expect(rocAuc([true, false, true, false], [0.5, 0.5, 0.5, 0.5])).toBe(0.5)
  })

  it('is 0.5 when one class is absent', () => {
    expect(rocAuc([true, true], [0.2, 0.9])).toBe(0.5)
  })

  it('handles partial ties with average ranks', () => {
    // Positives at 0.5 and 0.9; negatives at 0.1 and 0.5.
    // The tie at 0.5 contributes half a point.
    expect(rocAuc([false, false, true, true], [0.1, 0.5, 0.5, 0.9])).toBeCloseTo(0.875, 6)
  })

  it('rejects mismatched lengths', () => {
    expect(() => rocAuc([true], [0.1, 0.2])).toThrow(RangeError)
  })
})

describe('bestF1Threshold', () => {
  it('finds a threshold that separates well-split scores', () => {
    const labels = [false, false, false, true, true, true]
    const scores = [0.1, 0.15, 0.2, 0.8, 0.85, 0.9]
    const { threshold, metrics } = bestF1Threshold(labels, scores)
    expect(metrics.f1).toBe(1)
    expect(threshold).toBeGreaterThan(0.2)
    expect(threshold).toBeLessThanOrEqual(0.8)
  })
})

describe('quantile', () => {
  it('returns the value below which the given fraction lies', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(quantile(values, 0.5)).toBe(50)
    expect(quantile(values, 0.99)).toBe(99)
    expect(quantile(values, 1)).toBe(100)
  })

  it('does not mutate its input', () => {
    const values = [3, 1, 2]
    quantile(values, 0.5)
    expect(values).toEqual([3, 1, 2])
  })

  it('returns NaN for empty input', () => {
    expect(quantile([], 0.5)).toBeNaN()
  })
})
