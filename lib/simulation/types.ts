import type { DetectionOutcome } from '@/lib/detection/detector'
import type { AttackKind, TelemetrySample } from '@/lib/detection/telemetry'

export type Severity = 'WARNING' | 'CRITICAL'

export interface Alert {
  readonly id: string
  readonly sequence: number
  readonly kind: AttackKind
  readonly severity: Severity
  readonly label: string
  readonly description: string
  readonly detail?: string
  readonly targetNames: readonly string[]
  readonly sample: TelemetrySample
  readonly detection: DetectionOutcome
  readonly occurredAt: string
}

export interface SimulationState {
  readonly activeAttack: AttackKind | null
  /** Current stage of the phishing chain, or null when no chain is running. */
  readonly phishStage: number | null
  readonly threatenedIds: readonly string[]
  readonly alerts: readonly Alert[]
  readonly attackCounts: Readonly<Record<AttackKind, number>>
  /** 0-100, decays over time rather than ratcheting upward permanently. */
  readonly threatScore: number
  /** Timestamp the score was last recomputed, for decay. */
  readonly scoreUpdatedAt: number
  readonly selectedSatelliteId: string | null
}

export interface AttackDefinition {
  readonly label: string
  readonly description: string
  readonly severity: Severity
  readonly realWorldExample: string
}
