/**
 * Binary classification metrics. Pure functions, no I/O, so the numbers the
 * README and UI quote are reproducible and unit-tested rather than asserted.
 */

export interface ConfusionMatrix {
  readonly truePositives: number
  readonly falsePositives: number
  readonly trueNegatives: number
  readonly falseNegatives: number
}

export interface ClassificationMetrics extends ConfusionMatrix {
  readonly accuracy: number
  readonly precision: number
  readonly recall: number
  readonly f1: number
  /** True negative rate — how often nominal traffic is left alone. */
  readonly specificity: number
  /** False positive rate: the alert-fatigue number operators actually care about. */
  readonly falsePositiveRate: number
}

/** `labels[i]` is true for an attack sample; `predictions[i]` is true for "flagged". */
export function confusionMatrix(
  labels: readonly boolean[],
  predictions: readonly boolean[],
): ConfusionMatrix {
  if (labels.length !== predictions.length) {
    throw new RangeError('labels and predictions must be the same length')
  }

  let truePositives = 0
  let falsePositives = 0
  let trueNegatives = 0
  let falseNegatives = 0

  for (let i = 0; i < labels.length; i += 1) {
    const actual = labels[i] === true
    const predicted = predictions[i] === true
    if (actual && predicted) truePositives += 1
    else if (!actual && predicted) falsePositives += 1
    else if (!actual && !predicted) trueNegatives += 1
    else falseNegatives += 1
  }

  return { truePositives, falsePositives, trueNegatives, falseNegatives }
}

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator

export function classificationMetrics(
  labels: readonly boolean[],
  predictions: readonly boolean[],
): ClassificationMetrics {
  const matrix = confusionMatrix(labels, predictions)
  const { truePositives: tp, falsePositives: fp, trueNegatives: tn, falseNegatives: fn } = matrix

  const precision = ratio(tp, tp + fp)
  const recall = ratio(tp, tp + fn)

  return {
    ...matrix,
    accuracy: ratio(tp + tn, tp + tn + fp + fn),
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
    specificity: ratio(tn, tn + fp),
    falsePositiveRate: ratio(fp, fp + tn),
  }
}

/**
 * ROC AUC via the Mann-Whitney U statistic, with average ranks for ties.
 *
 * Threshold-free, so it measures the detector's ranking quality independently
 * of where the alerting cutoff is set.
 */
export function rocAuc(labels: readonly boolean[], scores: readonly number[]): number {
  if (labels.length !== scores.length) {
    throw new RangeError('labels and scores must be the same length')
  }

  const positives = labels.filter((label) => label).length
  const negatives = labels.length - positives
  if (positives === 0 || negatives === 0) return 0.5

  const indices = scores.map((score, index) => ({ score, label: labels[index] === true }))
  indices.sort((a, b) => a.score - b.score)

  // Assign average ranks within each group of equal scores.
  const ranks = new Array<number>(indices.length)
  let i = 0
  while (i < indices.length) {
    let j = i
    while (j + 1 < indices.length && indices[j + 1]?.score === indices[i]?.score) j += 1
    const averageRank = (i + j) / 2 + 1
    for (let k = i; k <= j; k += 1) ranks[k] = averageRank
    i = j + 1
  }

  let rankSumPositives = 0
  for (let k = 0; k < indices.length; k += 1) {
    if (indices[k]?.label === true) rankSumPositives += ranks[k] ?? 0
  }

  return (rankSumPositives - (positives * (positives + 1)) / 2) / (positives * negatives)
}

export interface ThresholdChoice {
  readonly threshold: number
  readonly metrics: ClassificationMetrics
}

/**
 * Sweeps candidate thresholds and returns the one maximising F1.
 *
 * Reported alongside the threshold actually shipped, so the difference between
 * "best achievable" and "what the product uses" stays visible.
 */
export function bestF1Threshold(
  labels: readonly boolean[],
  scores: readonly number[],
  steps = 200,
): ThresholdChoice {
  const min = Math.min(...scores)
  const max = Math.max(...scores)

  let best: ThresholdChoice = {
    threshold: min,
    metrics: classificationMetrics(labels, scores.map(() => true)),
  }

  for (let step = 0; step <= steps; step += 1) {
    const threshold = min + ((max - min) * step) / steps
    const metrics = classificationMetrics(labels, scores.map((score) => score >= threshold))
    if (metrics.f1 > best.metrics.f1) best = { threshold, metrics }
  }

  return best
}

/** Value below which `fraction` of the sorted input lies. Used to set the operating threshold. */
export function quantile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const position = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[position] ?? Number.NaN
}
