/**
 * Verifies that the committed detector metrics still reflect a real run.
 *
 * The figures shown in the UI and quoted in the README are read from
 * lib/detection/evaluation-results.json. If a change to the detector or the
 * telemetry model moves the numbers, the committed file must move with them —
 * otherwise the product displays an accuracy no run produced.
 *
 * Why this compares with a tolerance rather than byte-for-byte
 * -----------------------------------------------------------
 * `Math.log`, `Math.sin` and `Math.cos` are implementation-defined in
 * ECMAScript — engines are not required to produce bit-identical results across
 * platforms. The Box-Muller sampler in lib/detection/random.ts uses all three,
 * so training samples can differ in the last ulp between Windows and Linux.
 * Because tree splits are discrete, an ulp of difference can flip which side of
 * a split a point falls on, which perturbs the aggregate metrics slightly.
 *
 * The invariant worth defending is "the published numbers reflect a genuine run
 * of this code", not "the JSON is byte-identical on every operating system". An
 * exact comparison fails on a green build, which trains people to ignore CI.
 * The tolerances below are far tighter than any real regression: breaking the
 * forest moves accuracy by tens of points, not fractions of one.
 *
 * Implemented in Node rather than a shell pipeline so it runs identically on
 * every platform and needs no `jq`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runEvaluation, type EvaluationResult } from '../lib/detection/evaluate'

/** Rates live in [0, 1]; one percentage point is well inside noise. */
const RATE_TOLERANCE = 0.01

/** Isolation Forest scores are in [0, 1]. */
const THRESHOLD_TOLERANCE = 0.02

/** Confusion-matrix counts, as a fraction of the test set. */
const COUNT_TOLERANCE_FRACTION = 0.01

const resultsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'lib',
  'detection',
  'evaluation-results.json',
)

interface Failure {
  readonly field: string
  readonly committed: unknown
  readonly fresh: unknown
  readonly note: string
}

const failures: Failure[] = []

function compareNumber(field: string, committed: number, fresh: number, tolerance: number): void {
  const delta = Math.abs(committed - fresh)
  if (delta > tolerance) {
    failures.push({
      field,
      committed,
      fresh,
      note: `differs by ${delta.toPrecision(3)} (tolerance ${tolerance})`,
    })
  }
}

function compareExact(field: string, committed: unknown, fresh: unknown): void {
  if (JSON.stringify(committed) !== JSON.stringify(fresh)) {
    failures.push({ field, committed, fresh, note: 'must match exactly' })
  }
}

const committed = JSON.parse(readFileSync(resultsPath, 'utf8')) as EvaluationResult
const fresh = runEvaluation()

// Configuration is integers and seeds — any change here is intentional.
compareExact('config', committed.config, fresh.config)

compareNumber('threshold', committed.threshold, fresh.threshold, THRESHOLD_TOLERANCE)
compareNumber('rocAuc', committed.rocAuc, fresh.rocAuc, RATE_TOLERANCE)

for (const metric of ['accuracy', 'precision', 'recall', 'f1', 'specificity', 'falsePositiveRate'] as const) {
  compareNumber(`overall.${metric}`, committed.overall[metric], fresh.overall[metric], RATE_TOLERANCE)
}

const testSetSize =
  fresh.config.testNominalSamples + fresh.config.testSamplesPerAttack * 5
const countTolerance = Math.ceil(testSetSize * COUNT_TOLERANCE_FRACTION)

for (const cell of ['truePositives', 'falsePositives', 'trueNegatives', 'falseNegatives'] as const) {
  compareNumber(`overall.${cell}`, committed.overall[cell], fresh.overall[cell], countTolerance)
}

for (const kind of Object.keys(fresh.recallByAttack) as (keyof typeof fresh.recallByAttack)[]) {
  compareNumber(
    `recallByAttack.${kind}`,
    committed.recallByAttack[kind],
    fresh.recallByAttack[kind],
    RATE_TOLERANCE,
  )
}

compareNumber(
  'bestAchievableF1.f1',
  committed.bestAchievableF1.f1,
  fresh.bestAchievableF1.f1,
  RATE_TOLERANCE,
)

if (failures.length === 0) {
  process.stdout.write(
    `Committed evaluation is current.\n` +
      `  accuracy ${(fresh.overall.accuracy * 100).toFixed(1)}%  ` +
      `AUC ${fresh.rocAuc.toFixed(4)}  ` +
      `phish recall ${(fresh.recallByAttack.phish * 100).toFixed(1)}%\n`,
  )
  process.exit(0)
}

process.stderr.write('Committed evaluation no longer matches a fresh run.\n\n')
for (const failure of failures) {
  process.stderr.write(
    `  ${failure.field}\n` +
      `    committed: ${JSON.stringify(failure.committed)}\n` +
      `    fresh:     ${JSON.stringify(failure.fresh)}\n` +
      `    ${failure.note}\n\n`,
  )
}
process.stderr.write("Run 'npm run evaluate' and commit the result.\n")
process.exit(1)
