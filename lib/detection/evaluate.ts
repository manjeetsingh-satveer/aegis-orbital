/**
 * Evaluation harness for the AEGIS detector.
 *
 * Produces the accuracy figures the UI displays. The legacy build hardcoded
 * "94.7%" in markup with nothing behind it; this script generates the number,
 * records the configuration that produced it, and writes both to JSON so the
 * claim is reproducible with `npm run evaluate`.
 *
 * Protocol:
 *   1. Train on nominal traffic only — Isolation Forest assumes a
 *      predominantly-normal training set.
 *   2. Fix the alerting threshold from the *training* score distribution, so
 *      the threshold never sees the test set.
 *   3. Score a held-out mix of nominal and attack samples drawn from a
 *      different RNG stream.
 */
import { IsolationForest } from './isolation-forest'
import { bestF1Threshold, classificationMetrics, quantile, rocAuc, type ClassificationMetrics } from './metrics'
import { createRng } from './random'
import { ATTACK_KINDS, generateAttack, generateNominal, toFeatureVector, type AttackKind } from './telemetry'

export interface EvaluationConfig {
  readonly numTrees: number
  readonly sampleSize: number
  readonly trainingSamples: number
  readonly testNominalSamples: number
  readonly testSamplesPerAttack: number
  /** Fraction of nominal training scores below the alerting threshold. */
  readonly targetSpecificity: number
  readonly trainSeed: number
  readonly testSeed: number
}

export const DEFAULT_EVALUATION_CONFIG: EvaluationConfig = {
  numTrees: 128,
  sampleSize: 256,
  trainingSamples: 4000,
  testNominalSamples: 4000,
  testSamplesPerAttack: 800,
  targetSpecificity: 0.99,
  trainSeed: 42,
  testSeed: 1337,
}

export interface EvaluationResult {
  readonly generatedAt: string
  readonly config: EvaluationConfig
  readonly threshold: number
  readonly overall: ClassificationMetrics
  readonly rocAuc: number
  /** Recall for each attack class at the shipped threshold. */
  readonly recallByAttack: Readonly<Record<AttackKind, number>>
  readonly bestAchievableF1: { readonly threshold: number; readonly f1: number }
}

export function runEvaluation(config: EvaluationConfig = DEFAULT_EVALUATION_CONFIG): EvaluationResult {
  const trainRng = createRng(config.trainSeed)
  const testRng = createRng(config.testSeed)

  // ── 1. Train on nominal traffic only ───────────────────────────────────────
  const trainingData = Array.from({ length: config.trainingSamples }, () =>
    toFeatureVector(generateNominal(trainRng)),
  )

  const forest = new IsolationForest({
    numTrees: config.numTrees,
    sampleSize: config.sampleSize,
    seed: config.trainSeed,
  }).fit(trainingData)

  // ── 2. Fix the threshold from training scores, never from test data ────────
  const trainingScores = forest.score(trainingData)
  const threshold = quantile(trainingScores, config.targetSpecificity)

  // ── 3. Score a held-out mixed test set ─────────────────────────────────────
  const testVectors: number[][] = []
  const testLabels: boolean[] = []
  const testAttackKinds: (AttackKind | null)[] = []

  for (let i = 0; i < config.testNominalSamples; i += 1) {
    testVectors.push(toFeatureVector(generateNominal(testRng)))
    testLabels.push(false)
    testAttackKinds.push(null)
  }

  for (const kind of ATTACK_KINDS) {
    for (let i = 0; i < config.testSamplesPerAttack; i += 1) {
      testVectors.push(toFeatureVector(generateAttack(kind, testRng)))
      testLabels.push(true)
      testAttackKinds.push(kind)
    }
  }

  const testScores = forest.score(testVectors)
  const predictions = testScores.map((score) => score >= threshold)

  const overall = classificationMetrics(testLabels, predictions)
  const auc = rocAuc(testLabels, testScores)
  const best = bestF1Threshold(testLabels, testScores)

  const recallByAttack = {} as Record<AttackKind, number>
  for (const kind of ATTACK_KINDS) {
    let detected = 0
    let total = 0
    for (let i = 0; i < testAttackKinds.length; i += 1) {
      if (testAttackKinds[i] !== kind) continue
      total += 1
      if (predictions[i] === true) detected += 1
    }
    recallByAttack[kind] = total === 0 ? 0 : detected / total
  }

  return {
    generatedAt: new Date().toISOString(),
    config,
    threshold,
    overall,
    rocAuc: auc,
    recallByAttack,
    bestAchievableF1: { threshold: best.threshold, f1: best.metrics.f1 },
  }
}

/** Formats a result for terminal output. */
export function formatEvaluation(result: EvaluationResult): string {
  const pct = (value: number): string => `${(value * 100).toFixed(1)}%`
  const lines = [
    'AEGIS detector evaluation',
    '─'.repeat(52),
    `trees=${result.config.numTrees}  sample=${result.config.sampleSize}  train=${result.config.trainingSamples}`,
    `threshold=${result.threshold.toFixed(4)} (set at ${pct(result.config.targetSpecificity)} training specificity)`,
    '',
    `accuracy     ${pct(result.overall.accuracy)}`,
    `precision    ${pct(result.overall.precision)}`,
    `recall       ${pct(result.overall.recall)}`,
    `F1           ${pct(result.overall.f1)}`,
    `specificity  ${pct(result.overall.specificity)}`,
    `false pos.   ${pct(result.overall.falsePositiveRate)}`,
    `ROC AUC      ${result.rocAuc.toFixed(4)}`,
    '',
    'recall by attack class',
    ...ATTACK_KINDS.map((kind) => `  ${kind.padEnd(8)} ${pct(result.recallByAttack[kind])}`),
    '',
    `best achievable F1 ${pct(result.bestAchievableF1.f1)} at threshold ${result.bestAchievableF1.threshold.toFixed(4)}`,
  ]
  return lines.join('\n')
}
