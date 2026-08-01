import type { Rng } from './random'

/**
 * Telemetry feature space.
 *
 * IMPORTANT: these samples are SIMULATED. AEGIS has no access to real satellite
 * telemetry — operators do not publish uplink SNR or telecommand rates. The
 * baselines and attack signatures below are modelled on published incident
 * reporting and are used to exercise the detector, not to represent live
 * measurements from the satellites shown on the globe.
 */
export const TELEMETRY_FEATURES = [
  'snrDb',
  'commandRatePerSec',
  'positionDeltaKm',
  'signalStrengthDbm',
  'packetLossRatio',
  'nonceDuplicates',
] as const

export type TelemetryFeature = (typeof TELEMETRY_FEATURES)[number]

export type TelemetrySample = Readonly<Record<TelemetryFeature, number>>

export type AttackKind = 'spoof' | 'jam' | 'inject' | 'replay' | 'phish'

export const ATTACK_KINDS: readonly AttackKind[] = ['spoof', 'jam', 'inject', 'replay', 'phish']

/** Nominal operating point, with the standard deviation of routine variation. */
export const NOMINAL_BASELINE: Readonly<Record<TelemetryFeature, { mean: number; stdDev: number }>> = {
  snrDb: { mean: 14.0, stdDev: 1.4 },
  commandRatePerSec: { mean: 0.3, stdDev: 0.035 },
  positionDeltaKm: { mean: 0.08, stdDev: 0.02 },
  signalStrengthDbm: { mean: -78, stdDev: 1.75 },
  packetLossRatio: { mean: 0.008, stdDev: 0.002 },
  nonceDuplicates: { mean: 0, stdDev: 0.15 },
}

/**
 * Attack signatures. Each entry overrides a subset of the baseline; features
 * left undefined keep their nominal distribution, which is what makes the
 * detection problem non-trivial — no single feature separates every class.
 */
const ATTACK_PROFILES: Readonly<
  Record<AttackKind, Partial<Record<TelemetryFeature, { mean: number; stdDev: number }>>>
> = {
  // Counterfeit navigation signal: position solution diverges, carrier is hot.
  spoof: {
    positionDeltaKm: { mean: 2.45, stdDev: 0.28 },
    snrDb: { mean: 21.4, stdDev: 1.3 },
  },
  // Noise floor raised across the uplink band.
  jam: {
    snrDb: { mean: -2.5, stdDev: 1.1 },
    signalStrengthDbm: { mean: -112, stdDev: 3.2 },
    packetLossRatio: { mean: 0.49, stdDev: 0.05 },
  },
  // Unauthorised telecommand burst.
  inject: {
    commandRatePerSec: { mean: 4.3, stdDev: 0.32 },
    packetLossRatio: { mean: 0.52, stdDev: 0.04 },
  },
  // Captured packets retransmitted: duplicate nonces are the tell.
  replay: {
    commandRatePerSec: { mean: 2.6, stdDev: 0.22 },
    nonceDuplicates: { mean: 8.5, stdDev: 1.2 },
    packetLossRatio: { mean: 0.17, stdDev: 0.03 },
  },
  // Ground-station credential compromise. The satellite link itself looks
  // healthy; only the command cadence betrays the operator impersonation, which
  // is precisely why this class is the hardest to detect.
  phish: {
    commandRatePerSec: { mean: 1.9, stdDev: 0.45 },
    nonceDuplicates: { mean: 1.4, stdDev: 0.6 },
  },
}

function draw(rng: Rng, mean: number, stdDev: number): number {
  return mean + rng.nextGaussian() * stdDev
}

/** Physical bounds. Packet loss is a ratio; nonce duplicates are a count. */
function clamp(feature: TelemetryFeature, value: number): number {
  switch (feature) {
    case 'packetLossRatio':
      return Math.min(1, Math.max(0, value))
    case 'nonceDuplicates':
      return Math.max(0, Math.round(value))
    case 'positionDeltaKm':
      return Math.max(0, value)
    default:
      return value
  }
}

export function generateNominal(rng: Rng): TelemetrySample {
  const sample = {} as Record<TelemetryFeature, number>
  for (const feature of TELEMETRY_FEATURES) {
    const { mean, stdDev } = NOMINAL_BASELINE[feature]
    sample[feature] = clamp(feature, draw(rng, mean, stdDev))
  }
  return sample
}

export function generateAttack(kind: AttackKind, rng: Rng): TelemetrySample {
  const profile = ATTACK_PROFILES[kind]
  const sample = {} as Record<TelemetryFeature, number>
  for (const feature of TELEMETRY_FEATURES) {
    const override = profile[feature]
    const { mean, stdDev } = override ?? NOMINAL_BASELINE[feature]
    sample[feature] = clamp(feature, draw(rng, mean, stdDev))
  }
  return sample
}

/**
 * Telemetry for a phishing chain at a given stage. The command rate ramps as
 * the attacker escalates from reconnaissance to queuing rogue uplinks, so early
 * stages are close to nominal by design.
 */
export function generatePhishStage(stage: number, totalStages: number, rng: Rng): TelemetrySample {
  const progress = totalStages <= 1 ? 1 : Math.min(1, Math.max(0, stage / (totalStages - 1)))
  const base = generateNominal(rng)
  return {
    ...base,
    commandRatePerSec: clamp('commandRatePerSec', base.commandRatePerSec + progress * 4.0),
    packetLossRatio: clamp('packetLossRatio', base.packetLossRatio + progress * 0.06),
    nonceDuplicates: clamp('nonceDuplicates', progress * 3),
  }
}

export function toFeatureVector(sample: TelemetrySample): number[] {
  return TELEMETRY_FEATURES.map((feature) => sample[feature])
}

/**
 * Isolation Forest splits uniformly within each node's observed range, so it is
 * invariant to per-feature scale and needs no standardisation. This helper
 * exists for reporting and for any future detector that is scale-sensitive.
 */
export function describeSample(sample: TelemetrySample): string {
  return TELEMETRY_FEATURES.map((f) => `${f}=${sample[f].toFixed(3)}`).join(' ')
}
