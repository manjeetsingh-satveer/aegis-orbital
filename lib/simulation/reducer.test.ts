import { beforeEach, describe, expect, it } from 'vitest'
import { createRng } from '@/lib/detection/random'
import { generateAttack, generateNominal, generatePhishStage } from '@/lib/detection/telemetry'
import {
  decayScore,
  INITIAL_STATE,
  PHISH_STAGES,
  pickTargets,
  resetAlertSequence,
  simulationReducer,
  threatBand,
  type SimulationAction,
} from './reducer'
import type { SimulationState } from './types'

const rng = createRng(5)
const T0 = 1_700_000_000_000

const launch = (overrides: Partial<Extract<SimulationAction, { type: 'launch' }>> = {}) =>
  ({
    type: 'launch',
    kind: 'spoof',
    targetIds: ['sat-1', 'sat-2'],
    targetNames: ['ISS', 'GPS BIII-1'],
    sample: generateAttack('spoof', rng),
    now: T0,
    ...overrides,
  }) satisfies SimulationAction

beforeEach(() => {
  resetAlertSequence()
})

describe('pickTargets', () => {
  // The legacy sim() looped until it had N distinct indices from a pool that
  // could be smaller than N, hanging the tab whenever few satellites loaded.
  it('terminates when the requested count exceeds the pool', () => {
    expect(pickTargets(['a'], 3)).toEqual(['a'])
    expect(pickTargets(['a', 'b'], 8)).toHaveLength(2)
    expect(pickTargets([], 5)).toEqual([])
  })

  it('terminates even when the RNG always returns the same index', () => {
    const targets = pickTargets(['a', 'b', 'c', 'd'], 3, () => 0)
    expect(targets).toHaveLength(3)
    expect(new Set(targets).size).toBe(3)
  })

  it('returns distinct ids', () => {
    const targets = pickTargets(['a', 'b', 'c', 'd', 'e'], 4, () => rng.next())
    expect(new Set(targets).size).toBe(targets.length)
  })

  it('never exceeds the requested count', () => {
    expect(pickTargets(['a', 'b', 'c', 'd', 'e'], 2, () => rng.next())).toHaveLength(2)
  })
})

describe('simulationReducer — launch', () => {
  it('records an alert, marks targets, and increments the counter', () => {
    const state = simulationReducer(INITIAL_STATE, launch())
    expect(state.activeAttack).toBe('spoof')
    expect(state.threatenedIds).toEqual(['sat-1', 'sat-2'])
    expect(state.alerts).toHaveLength(1)
    expect(state.attackCounts.spoof).toBe(1)
    expect(state.threatScore).toBeGreaterThan(0)
  })

  it('attaches the detector verdict to the alert', () => {
    const state = simulationReducer(INITIAL_STATE, launch({ kind: 'jam', sample: generateAttack('jam', rng) }))
    const alert = state.alerts[0]
    expect(alert?.detection.flagged).toBe(true)
    expect(alert?.detection.score).toBeGreaterThan(0)
  })

  it('caps the alert feed', () => {
    let state = INITIAL_STATE
    for (let i = 0; i < 40; i += 1) {
      state = simulationReducer(state, launch({ now: T0 + i * 1000 }))
    }
    expect(state.alerts.length).toBeLessThanOrEqual(25)
    // Newest first.
    expect(state.alerts[0]?.sequence).toBeGreaterThan(state.alerts[1]?.sequence ?? 0)
  })

  it('cancels an in-flight phishing chain', () => {
    const phishing = simulationReducer(INITIAL_STATE, {
      type: 'phish-stage',
      stage: 2,
      targetIds: ['a'],
      targetNames: ['A'],
      sample: generatePhishStage(2, PHISH_STAGES.length, rng),
      now: T0,
    })
    expect(phishing.phishStage).toBe(2)

    const launched = simulationReducer(phishing, launch({ now: T0 + 100 }))
    expect(launched.phishStage).toBeNull()
    expect(launched.activeAttack).toBe('spoof')
  })
})

describe('simulationReducer — phishing chain', () => {
  const phishStage = (stage: number, now: number): SimulationAction => ({
    type: 'phish-stage',
    stage,
    targetIds: ['sat-1', 'sat-2', 'sat-3'],
    targetNames: ['ISS', 'STARLINK-1007', 'NOAA 19'],
    sample: generatePhishStage(stage, PHISH_STAGES.length, rng),
    now,
  })

  it('counts one incident across all stages', () => {
    let state = INITIAL_STATE
    for (let stage = 0; stage < PHISH_STAGES.length; stage += 1) {
      state = simulationReducer(state, phishStage(stage, T0 + stage * 2500))
    }
    expect(state.attackCounts.phish).toBe(1)
    expect(state.alerts).toHaveLength(PHISH_STAGES.length)
  })

  it('ignores an out-of-range stage', () => {
    const state = simulationReducer(INITIAL_STATE, phishStage(99, T0))
    expect(state).toBe(INITIAL_STATE)
  })

  it('clears active state on completion', () => {
    const started = simulationReducer(INITIAL_STATE, phishStage(0, T0))
    const done = simulationReducer(started, { type: 'phish-complete', now: T0 + 15_000 })
    expect(done.activeAttack).toBeNull()
    expect(done.phishStage).toBeNull()
    expect(done.threatenedIds).toEqual([])
    // The incident stays in the feed after the attack ends.
    expect(done.alerts.length).toBeGreaterThan(0)
  })
})

describe('simulationReducer — reset', () => {
  // Legacy resetSim() left the phishing timer running, never zeroed the attack
  // counters, and never cleared the threat score. All three are covered here.
  it('restores the initial state completely', () => {
    let state: SimulationState = INITIAL_STATE
    state = simulationReducer(state, launch())
    state = simulationReducer(state, launch({ kind: 'inject', now: T0 + 1000 }))
    state = simulationReducer(state, {
      type: 'phish-stage',
      stage: 0,
      targetIds: ['x'],
      targetNames: ['X'],
      sample: generatePhishStage(0, PHISH_STAGES.length, rng),
      now: T0 + 2000,
    })
    state = simulationReducer(state, { type: 'select', satelliteId: 'sat-9' })

    expect(state.alerts.length).toBeGreaterThan(0)
    expect(state.threatScore).toBeGreaterThan(0)

    const reset = simulationReducer(state, { type: 'reset' })
    expect(reset).toEqual(INITIAL_STATE)
    expect(reset.attackCounts.spoof).toBe(0)
    expect(reset.attackCounts.inject).toBe(0)
    expect(reset.attackCounts.phish).toBe(0)
    expect(reset.threatScore).toBe(0)
    expect(reset.phishStage).toBeNull()
    expect(reset.threatenedIds).toEqual([])
    expect(reset.selectedSatelliteId).toBeNull()
  })
})

describe('threat score decay', () => {
  it('halves over one half-life', () => {
    expect(decayScore(80, 45_000)).toBeCloseTo(40, 6)
    expect(decayScore(80, 90_000)).toBeCloseTo(20, 6)
  })

  it('does not change without elapsed time', () => {
    expect(decayScore(80, 0)).toBe(80)
    expect(decayScore(80, -100)).toBe(80)
  })

  // The legacy score was min(99, totalAttacks * 14) — monotonic, so the board
  // pinned at CRITICAL after seven clicks and never recovered.
  it('recovers to LOW RISK given enough quiet time', () => {
    let state = simulationReducer(INITIAL_STATE, launch({ kind: 'inject' }))
    expect(threatBand(state.threatScore)).not.toBe('LOW RISK')

    state = simulationReducer(state, { type: 'tick', now: T0 + 5 * 60_000 })
    expect(state.threatScore).toBeLessThan(1)
    expect(threatBand(state.threatScore)).toBe('LOW RISK')
  })

  it('is bounded at 99 under sustained attack', () => {
    let state = INITIAL_STATE
    for (let i = 0; i < 30; i += 1) {
      state = simulationReducer(state, launch({ kind: 'inject', now: T0 + i * 500 }))
    }
    expect(state.threatScore).toBeLessThanOrEqual(99)
  })

  it('leaves a zero score untouched on tick', () => {
    const state = simulationReducer(INITIAL_STATE, { type: 'tick', now: T0 })
    expect(state).toBe(INITIAL_STATE)
  })
})

describe('threatBand', () => {
  it('maps scores to display bands', () => {
    expect(threatBand(0)).toBe('LOW RISK')
    expect(threatBand(30)).toBe('LOW RISK')
    expect(threatBand(45)).toBe('ELEVATED')
    expect(threatBand(75)).toBe('CRITICAL')
  })
})

describe('selection', () => {
  it('stores and clears the selected satellite', () => {
    const selected = simulationReducer(INITIAL_STATE, { type: 'select', satelliteId: 'sat-4' })
    expect(selected.selectedSatelliteId).toBe('sat-4')
    const cleared = simulationReducer(selected, { type: 'select', satelliteId: null })
    expect(cleared.selectedSatelliteId).toBeNull()
  })

  it('returns the same object when selection is unchanged', () => {
    const selected = simulationReducer(INITIAL_STATE, { type: 'select', satelliteId: 'sat-4' })
    expect(simulationReducer(selected, { type: 'select', satelliteId: 'sat-4' })).toBe(selected)
  })
})

describe('nominal telemetry', () => {
  it('is usually not flagged', () => {
    let flagged = 0
    const total = 200
    for (let i = 0; i < total; i += 1) {
      const state = simulationReducer(INITIAL_STATE, launch({ sample: generateNominal(rng) }))
      if (state.alerts[0]?.detection.flagged === true) flagged += 1
    }
    // Threshold is calibrated to ~1% false positives; allow headroom for noise.
    expect(flagged / total).toBeLessThan(0.05)
  })
})
