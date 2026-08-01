import { detect } from '@/lib/detection/detector'
import type { AttackKind, TelemetrySample } from '@/lib/detection/telemetry'
import { ATTACK_KINDS } from '@/lib/detection/telemetry'
import type { Alert, AttackDefinition, SimulationState } from './types'

/**
 * Simulation state machine.
 *
 * The legacy implementation spread this across a dozen module-level mutable
 * globals plus a `setTimeout` handle, and RESET SIMULATION cleared only some of
 * them. Specifically it left the phishing timer running (so alerts reappeared
 * seconds after a reset), never zeroed the attack counters (so the threat score
 * stayed maxed), and never cleared the inline styles it had written onto the
 * phishing button. Reducing over one immutable state object makes those classes
 * of bug unrepresentable: `reset` returns INITIAL_STATE, and the timer lives in
 * an effect keyed on `phishStage`, so state changes cancel it automatically.
 */

export const PHISH_STAGES: readonly { readonly message: string; readonly detail: string }[] = [
  {
    message: 'Spear-phish email delivered to ground station operator',
    detail: 'Spoofed sender: ops-team@groundstation-secure.net · Payload: credential harvester',
  },
  {
    message: 'Operator followed the link — credentials captured',
    detail: 'Username and password harvested · Session cookie stolen · MFA prompt bypassed',
  },
  {
    message: 'Attacker authenticated to ground station control panel',
    detail: 'Access level: OPERATOR · Authenticated with stolen session token',
  },
  {
    message: 'Rogue uplink commands queued for target satellites',
    detail: 'Unauthorised maneuver commands staged · Three LEO assets targeted',
  },
  {
    message: 'Anomalous command burst detected',
    detail: 'Command cadence diverges from operator baseline · Isolation Forest flagged the window',
  },
  {
    message: 'Ground station access revoked · Incident logged',
    detail: 'Session terminated · Queued commands blocked · Forensic capture initiated',
  },
]

/** Milliseconds between phishing chain stages. */
export const PHISH_STAGE_INTERVAL_MS = 2500

export const ATTACK_DEFINITIONS: Readonly<Record<AttackKind, AttackDefinition>> = {
  spoof: {
    label: 'GPS Spoofing',
    description:
      'Counterfeit navigation signal overpowers the authentic one; the position solution diverges by kilometres while the carrier reads unusually strong.',
    severity: 'CRITICAL',
    realWorldExample: 'Black Sea GPS anomalies (2017) · Iranian capture of a US RQ-170 (2011)',
  },
  jam: {
    label: 'Signal Jamming',
    description:
      'Broadband noise raises the uplink noise floor. Signal-to-noise collapses below zero and packet loss climbs past 40%.',
    severity: 'WARNING',
    realWorldExample: 'Recurrent GPS jamming over the Korean peninsula',
  },
  inject: {
    label: 'Command Injection',
    description:
      'Unauthorised telecommand sequence pushed to the spacecraft. Command rate jumps an order of magnitude above the operator baseline.',
    severity: 'CRITICAL',
    realWorldExample: 'Viasat KA-SAT modem wiper deployment (February 2022)',
  },
  replay: {
    label: 'Replay Attack',
    description:
      'Previously captured telecommand packets retransmitted. Duplicate nonces accompany an elevated command rate.',
    severity: 'WARNING',
    realWorldExample: 'Generic satellite telecommand replay without packet authentication',
  },
  phish: {
    label: 'Ground Station Phishing',
    description:
      'Credential compromise of a human operator. The space link itself stays healthy, which is exactly why this class is the hardest to detect from telemetry alone.',
    severity: 'CRITICAL',
    realWorldExample: 'Viasat KA-SAT ground network intrusion (February 2022)',
  },
}

const ZERO_COUNTS: Readonly<Record<AttackKind, number>> = Object.freeze(
  Object.fromEntries(ATTACK_KINDS.map((kind) => [kind, 0])) as Record<AttackKind, number>,
)

export const INITIAL_STATE: SimulationState = {
  activeAttack: null,
  phishStage: null,
  threatenedIds: [],
  alerts: [],
  attackCounts: ZERO_COUNTS,
  threatScore: 0,
  scoreUpdatedAt: 0,
  selectedSatelliteId: null,
}

/**
 * Threat score contribution per event.
 *
 * Calibrated so a single CRITICAL attack clears the ELEVATED boundary (>30) on
 * its own — a lone command injection reading as "LOW RISK" would be misleading —
 * while two in quick succession reach CRITICAL (>60).
 */
const SCORE_IMPACT: Record<AttackKind, number> = {
  spoof: 32,
  jam: 18,
  inject: 36,
  replay: 16,
  phish: 31,
}

/**
 * Half-life of the threat score, in milliseconds.
 *
 * The legacy score was `min(99, totalAttacks * 14)`, which only ever increased —
 * seven simulations pinned the dashboard at CRITICAL with no way back short of
 * a page reload. Decay means the board recovers the way a real console would.
 */
const SCORE_HALF_LIFE_MS = 45_000

const MAX_ALERTS = 25

export function decayScore(score: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return score
  return score * 0.5 ** (elapsedMs / SCORE_HALF_LIFE_MS)
}

export type SimulationAction =
  | {
      readonly type: 'launch'
      readonly kind: Exclude<AttackKind, 'phish'>
      readonly targetIds: readonly string[]
      readonly targetNames: readonly string[]
      readonly sample: TelemetrySample
      readonly now: number
    }
  | {
      readonly type: 'phish-stage'
      readonly stage: number
      readonly targetIds: readonly string[]
      readonly targetNames: readonly string[]
      readonly sample: TelemetrySample
      readonly now: number
    }
  | { readonly type: 'phish-complete'; readonly now: number }
  | { readonly type: 'clear-active'; readonly now: number }
  | { readonly type: 'tick'; readonly now: number }
  | { readonly type: 'select'; readonly satelliteId: string | null }
  | { readonly type: 'reset' }

let alertSequence = 0

/** Test seam: keeps alert ids deterministic across runs. */
export function resetAlertSequence(): void {
  alertSequence = 0
}

function buildAlert(params: {
  kind: AttackKind
  targetNames: readonly string[]
  sample: TelemetrySample
  now: number
  descriptionOverride?: string
  detail?: string
}): Alert {
  const definition = ATTACK_DEFINITIONS[params.kind]
  const detection = detect(params.sample)
  alertSequence += 1

  return {
    id: `alert-${alertSequence}`,
    sequence: alertSequence,
    kind: params.kind,
    // Severity reflects what the detector actually concluded, not a fixed label
    // per attack type. An attack the model failed to flag is reported as a
    // WARNING, which is how the phishing chain's early stages present.
    severity: detection.flagged ? definition.severity : 'WARNING',
    label: definition.label,
    description: params.descriptionOverride ?? definition.description,
    ...(params.detail === undefined ? {} : { detail: params.detail }),
    targetNames: params.targetNames,
    sample: params.sample,
    detection,
    occurredAt: new Date(params.now).toISOString(),
  }
}

function withAlert(state: SimulationState, alert: Alert, now: number, impact: number): SimulationState {
  const decayed = decayScore(state.threatScore, now - state.scoreUpdatedAt)
  return {
    ...state,
    alerts: [alert, ...state.alerts].slice(0, MAX_ALERTS),
    threatScore: Math.min(99, decayed + impact),
    scoreUpdatedAt: now,
  }
}

export function simulationReducer(state: SimulationState, action: SimulationAction): SimulationState {
  switch (action.type) {
    case 'launch': {
      const alert = buildAlert({
        kind: action.kind,
        targetNames: action.targetNames,
        sample: action.sample,
        now: action.now,
      })
      return withAlert(
        {
          ...state,
          activeAttack: action.kind,
          // Launching a conventional attack cancels any phishing chain.
          phishStage: null,
          threatenedIds: action.targetIds,
          attackCounts: {
            ...state.attackCounts,
            [action.kind]: (state.attackCounts[action.kind] ?? 0) + 1,
          },
        },
        alert,
        action.now,
        SCORE_IMPACT[action.kind],
      )
    }

    case 'phish-stage': {
      const stage = PHISH_STAGES[action.stage]
      if (stage === undefined) return state

      const alert = buildAlert({
        kind: 'phish',
        targetNames: action.targetNames,
        sample: action.sample,
        now: action.now,
        descriptionOverride: stage.message,
        detail: stage.detail,
      })

      // Only the first stage increments the counter; later stages are the same
      // incident progressing.
      const isFirstStage = action.stage === 0

      return withAlert(
        {
          ...state,
          activeAttack: 'phish',
          phishStage: action.stage,
          threatenedIds: action.targetIds,
          attackCounts: isFirstStage
            ? { ...state.attackCounts, phish: (state.attackCounts.phish ?? 0) + 1 }
            : state.attackCounts,
        },
        alert,
        action.now,
        isFirstStage ? SCORE_IMPACT.phish : 3,
      )
    }

    case 'phish-complete':
    case 'clear-active':
      return {
        ...state,
        activeAttack: null,
        phishStage: null,
        threatenedIds: [],
        threatScore: decayScore(state.threatScore, action.now - state.scoreUpdatedAt),
        scoreUpdatedAt: action.now,
      }

    case 'tick':
      if (state.threatScore === 0) return state
      return {
        ...state,
        threatScore: decayScore(state.threatScore, action.now - state.scoreUpdatedAt),
        scoreUpdatedAt: action.now,
      }

    case 'select':
      if (state.selectedSatelliteId === action.satelliteId) return state
      return { ...state, selectedSatelliteId: action.satelliteId }

    // Returning the initial object wholesale is what guarantees nothing is
    // left behind — counters, alerts, threat score and phishing stage included.
    case 'reset':
      return INITIAL_STATE

    default:
      return state
  }
}

/** Derived display band for the threat score. */
export function threatBand(score: number): 'LOW RISK' | 'ELEVATED' | 'CRITICAL' {
  if (score > 60) return 'CRITICAL'
  if (score > 30) return 'ELEVATED'
  return 'LOW RISK'
}

/**
 * Picks up to `count` distinct satellite ids.
 *
 * The legacy `sim()` looped `while (chosen.length < n)` against a pool that
 * could be smaller than `n` — with one or two satellites loaded it spun forever
 * and froze the tab. Bounding by pool size is the fix.
 */
export function pickTargets(
  ids: readonly string[],
  count: number,
  random: () => number = Math.random,
): string[] {
  const limit = Math.min(count, ids.length)
  const chosen: string[] = []
  const seen = new Set<number>()

  // Bounded attempts, then fall back to a linear scan, so this always
  // terminates regardless of RNG behaviour.
  let attempts = 0
  const maxAttempts = limit * 12 + 24
  while (chosen.length < limit && attempts < maxAttempts) {
    attempts += 1
    const index = Math.floor(random() * ids.length)
    if (seen.has(index)) continue
    const id = ids[index]
    if (id === undefined) continue
    seen.add(index)
    chosen.push(id)
  }

  for (let index = 0; index < ids.length && chosen.length < limit; index += 1) {
    if (seen.has(index)) continue
    const id = ids[index]
    if (id === undefined) continue
    seen.add(index)
    chosen.push(id)
  }

  return chosen
}
