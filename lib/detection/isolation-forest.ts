import { createRng, sampleWithoutReplacement, type Rng } from './random'

/**
 * Isolation Forest — Liu, Ting & Zhou (ICDM 2008).
 *
 * Anomalies are easier to isolate than normal points, so they sit closer to the
 * root of a tree built from random splits. The forest averages isolation depth
 * across many trees and normalises it against the expected depth of an
 * unsuccessful binary search.
 *
 * The legacy implementation named itself "Isolation Forest" but computed a
 * weighted z-score through a sigmoid — no trees, no subsampling, no path
 * lengths. This is the real algorithm.
 */

/** Euler-Mascheroni constant, for the harmonic-number approximation. */
const EULER_MASCHERONI = 0.577_215_664_901_532_9

/** Harmonic number H(i), approximated as ln(i) + gamma. */
function harmonic(i: number): number {
  return Math.log(i) + EULER_MASCHERONI
}

/**
 * c(n): expected path length of an unsuccessful search in a binary search tree
 * of n points. Used to normalise depth into a bounded score.
 */
export function expectedPathLength(n: number): number {
  if (n <= 1) return 0
  if (n === 2) return 1
  return 2 * harmonic(n - 1) - (2 * (n - 1)) / n
}

interface InternalNode {
  readonly kind: 'internal'
  readonly featureIndex: number
  readonly splitValue: number
  readonly left: TreeNode
  readonly right: TreeNode
}

interface ExternalNode {
  readonly kind: 'external'
  readonly size: number
}

type TreeNode = InternalNode | ExternalNode

export interface IsolationForestOptions {
  /** Number of trees in the ensemble. Default 128. */
  readonly numTrees?: number
  /** Points drawn per tree. Default 256, the value recommended in the paper. */
  readonly sampleSize?: number
  /** PRNG seed, for reproducible forests. Default 42. */
  readonly seed?: number
}

export interface FittedForestSummary {
  readonly numTrees: number
  readonly sampleSize: number
  readonly numFeatures: number
  readonly trainingSize: number
  readonly seed: number
}

export class IsolationForest {
  readonly #numTrees: number
  readonly #sampleSize: number
  readonly #seed: number

  #trees: TreeNode[] = []
  #numFeatures = 0
  #trainingSize = 0
  #normalisation = 0

  constructor(options: IsolationForestOptions = {}) {
    const { numTrees = 128, sampleSize = 256, seed = 42 } = options
    if (numTrees < 1) throw new RangeError('numTrees must be at least 1')
    if (sampleSize < 2) throw new RangeError('sampleSize must be at least 2')
    this.#numTrees = numTrees
    this.#sampleSize = sampleSize
    this.#seed = seed
  }

  get isFitted(): boolean {
    return this.#trees.length > 0
  }

  get summary(): FittedForestSummary {
    return {
      numTrees: this.#numTrees,
      sampleSize: this.#sampleSize,
      numFeatures: this.#numFeatures,
      trainingSize: this.#trainingSize,
      seed: this.#seed,
    }
  }

  /**
   * Fits the forest. Train on nominal traffic: Isolation Forest assumes the
   * training set is predominantly normal, and contaminating it with attack
   * samples teaches the model to treat attacks as unremarkable.
   */
  fit(data: readonly (readonly number[])[]): this {
    if (data.length === 0) throw new RangeError('cannot fit on an empty dataset')

    const numFeatures = data[0]?.length ?? 0
    if (numFeatures === 0) throw new RangeError('feature vectors must be non-empty')
    for (const row of data) {
      if (row.length !== numFeatures) {
        throw new RangeError(`inconsistent feature count: expected ${numFeatures}, got ${row.length}`)
      }
    }

    const rng = createRng(this.#seed)
    const effectiveSampleSize = Math.min(this.#sampleSize, data.length)
    const heightLimit = Math.ceil(Math.log2(Math.max(2, effectiveSampleSize)))

    this.#trees = Array.from({ length: this.#numTrees }, () => {
      const subsample = sampleWithoutReplacement(data, effectiveSampleSize, rng)
      return buildTree(subsample, 0, heightLimit, numFeatures, rng)
    })

    this.#numFeatures = numFeatures
    this.#trainingSize = data.length
    this.#normalisation = expectedPathLength(effectiveSampleSize)
    return this
  }

  /**
   * Anomaly score in [0, 1]. Values near 1 are strongly anomalous; values well
   * below 0.5 are normal. The paper treats ~0.5 as "no clear signal".
   */
  scoreOne(point: readonly number[]): number {
    if (!this.isFitted) throw new Error('forest must be fitted before scoring')
    if (point.length !== this.#numFeatures) {
      throw new RangeError(`expected ${this.#numFeatures} features, got ${point.length}`)
    }
    if (this.#normalisation === 0) return 0

    let depthSum = 0
    for (const tree of this.#trees) depthSum += pathLength(tree, point, 0)
    const meanDepth = depthSum / this.#trees.length

    return 2 ** (-meanDepth / this.#normalisation)
  }

  score(data: readonly (readonly number[])[]): number[] {
    return data.map((point) => this.scoreOne(point))
  }

  /** Convenience for UI display: the [0,1] score mapped to 0-100. */
  scoreOneScaled(point: readonly number[]): number {
    return this.scoreOne(point) * 100
  }
}

function buildTree(
  data: readonly (readonly number[])[],
  depth: number,
  heightLimit: number,
  numFeatures: number,
  rng: Rng,
): TreeNode {
  if (depth >= heightLimit || data.length <= 1) {
    return { kind: 'external', size: data.length }
  }

  // Split only on features that actually vary in this subset; a constant
  // feature yields a degenerate split that wastes a level of depth.
  const varying: number[] = []
  for (let feature = 0; feature < numFeatures; feature += 1) {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const row of data) {
      const value = row[feature]
      if (value === undefined || !Number.isFinite(value)) continue
      if (value < min) min = value
      if (value > max) max = value
    }
    if (min < max) varying.push(feature)
  }

  if (varying.length === 0) {
    return { kind: 'external', size: data.length }
  }

  const featureIndex = varying[rng.nextInt(0, varying.length)] ?? 0

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const row of data) {
    const value = row[featureIndex]
    if (value === undefined || !Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
  }

  const splitValue = rng.nextFloat(min, max)

  const left: (readonly number[])[] = []
  const right: (readonly number[])[] = []
  for (const row of data) {
    const value = row[featureIndex]
    if (value !== undefined && value < splitValue) left.push(row)
    else right.push(row)
  }

  // Guard against a split that isolates nothing (possible with float edges).
  if (left.length === 0 || right.length === 0) {
    return { kind: 'external', size: data.length }
  }

  return {
    kind: 'internal',
    featureIndex,
    splitValue,
    left: buildTree(left, depth + 1, heightLimit, numFeatures, rng),
    right: buildTree(right, depth + 1, heightLimit, numFeatures, rng),
  }
}

/**
 * Depth at which `point` is isolated. External nodes holding more than one
 * sample are credited with c(size), the expected depth of the subtree that
 * would have been built had the height limit not stopped construction.
 */
function pathLength(node: TreeNode, point: readonly number[], depth: number): number {
  if (node.kind === 'external') {
    return depth + expectedPathLength(node.size)
  }
  const value = point[node.featureIndex]
  if (value === undefined || !Number.isFinite(value)) {
    // Missing feature: average both branches rather than guessing.
    return (pathLength(node.left, point, depth + 1) + pathLength(node.right, point, depth + 1)) / 2
  }
  return value < node.splitValue
    ? pathLength(node.left, point, depth + 1)
    : pathLength(node.right, point, depth + 1)
}
