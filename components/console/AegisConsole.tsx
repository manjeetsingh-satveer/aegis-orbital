'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createRng } from '@/lib/detection/random'
import {
  generateAttack,
  generateNominal,
  generatePhishStage,
  type AttackKind,
} from '@/lib/detection/telemetry'
import { useLandRings, useSatellites } from '@/lib/hooks/use-satellites'
import { estimatedAccuracyKm } from '@/lib/orbital/propagate'
import {
  INITIAL_STATE,
  PHISH_STAGES,
  PHISH_STAGE_INTERVAL_MS,
  pickTargets,
  simulationReducer,
  threatBand,
} from '@/lib/simulation/reducer'
import { AlertFeed } from './AlertFeed'
import { GlobeView } from './GlobeView'
import { MetricsPanel } from './MetricsPanel'
import { ThreatSandbox } from './ThreatSandbox'
import styles from './AegisConsole.module.css'

type Tab = 'globe' | 'sources' | 'threats' | 'alerts'

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'globe', label: 'Globe' },
  { id: 'sources', label: 'Data Sources' },
  { id: 'threats', label: 'Threat Types' },
  { id: 'alerts', label: 'Alerts' },
]

/** Shared RNG for telemetry sampling; seeded so sessions are reproducible. */
const telemetryRng = createRng(Date.now() & 0xffff)

export function AegisConsole(): React.ReactElement {
  const [state, dispatch] = useReducer(simulationReducer, INITIAL_STATE)
  const [tab, setTab] = useState<Tab>('globe')
  const [labelMode, setLabelMode] = useState<'smart' | 'all' | 'none'>('smart')

  const { satellites, status, counts, source, maxEpochAgeHours, error } = useSatellites()
  const landRings = useLandRings()

  const satelliteIds = useMemo(() => satellites.map((satellite) => satellite.id), [satellites])
  const nameById = useMemo(
    () => new Map(satellites.map((satellite) => [satellite.id, satellite.name])),
    [satellites],
  )
  const threatIdSet = useMemo(() => new Set(state.threatenedIds), [state.threatenedIds])

  const namesFor = useCallback(
    (ids: readonly string[]): string[] => ids.map((id) => nameById.get(id) ?? id).slice(0, 3),
    [nameById],
  )

  // ── Conventional attacks ──────────────────────────────────────────────────
  const launchAttack = useCallback(
    (kind: Exclude<AttackKind, 'phish'>) => {
      const targetCount = Math.min(8, Math.max(3, Math.floor(satelliteIds.length / 15) || 3))
      const targetIds = pickTargets(satelliteIds, targetCount, () => telemetryRng.next())
      dispatch({
        type: 'launch',
        kind,
        targetIds,
        targetNames: namesFor(targetIds),
        sample: generateAttack(kind, telemetryRng),
        now: Date.now(),
      })
    },
    [satelliteIds, namesFor],
  )

  // ── Phishing chain ────────────────────────────────────────────────────────
  // The stage timer lives in an effect keyed on phishStage. A reset sets
  // phishStage to null, the effect tears down, and the pending timeout is
  // cancelled — the legacy bug where reset left the chain firing cannot recur.
  const phishTargetsRef = useRef<string[]>([])

  const startPhishing = useCallback(() => {
    const targetIds = pickTargets(satelliteIds, 3, () => telemetryRng.next())
    phishTargetsRef.current = targetIds
    dispatch({
      type: 'phish-stage',
      stage: 0,
      targetIds,
      targetNames: namesFor(targetIds),
      sample: generatePhishStage(0, PHISH_STAGES.length, telemetryRng),
      now: Date.now(),
    })
  }, [satelliteIds, namesFor])

  useEffect(() => {
    const stage = state.phishStage
    if (stage === null) return

    const isFinalStage = stage >= PHISH_STAGES.length - 1
    const targetIds = phishTargetsRef.current

    const timer = window.setTimeout(() => {
      if (isFinalStage) {
        dispatch({ type: 'phish-complete', now: Date.now() })
        return
      }
      dispatch({
        type: 'phish-stage',
        stage: stage + 1,
        targetIds,
        targetNames: namesFor(targetIds),
        sample: generatePhishStage(stage + 1, PHISH_STAGES.length, telemetryRng),
        now: Date.now(),
      })
    }, PHISH_STAGE_INTERVAL_MS)

    return () => window.clearTimeout(timer)
  }, [state.phishStage, namesFor])

  // ── Threat score decay ────────────────────────────────────────────────────
  useEffect(() => {
    const interval = window.setInterval(() => dispatch({ type: 'tick', now: Date.now() }), 2000)
    return () => window.clearInterval(interval)
  }, [])

  // ── Live telemetry for the selected satellite, sampled at 1Hz ─────────────
  // The legacy build recomputed this inside the render loop, so every value in
  // the detail card was re-randomised 60 times a second and unreadable.
  const [liveSample, setLiveSample] = useState(() => generateNominal(telemetryRng))

  useEffect(() => {
    const isThreatened =
      state.selectedSatelliteId !== null && threatIdSet.has(state.selectedSatelliteId)

    const sample = (): void => {
      setLiveSample(
        isThreatened && state.activeAttack !== null
          ? generateAttack(state.activeAttack, telemetryRng)
          : generateNominal(telemetryRng),
      )
    }

    sample()
    const interval = window.setInterval(sample, 1000)
    return () => window.clearInterval(interval)
  }, [state.selectedSatelliteId, state.activeAttack, threatIdSet])

  const selectedSatellite = useMemo(
    () => satellites.find((satellite) => satellite.id === state.selectedSatelliteId) ?? null,
    [satellites, state.selectedSatelliteId],
  )

  const handleSelect = useCallback((satelliteId: string | null) => {
    dispatch({ type: 'select', satelliteId })
  }, [])

  const band = threatBand(state.threatScore)
  const accuracyKm = estimatedAccuracyKm(maxEpochAgeHours)

  return (
    <div className={styles.app}>
      <a className="skip-link" href="#sandbox">
        Skip to threat simulation controls
      </a>

      <Header
        satelliteCount={satellites.length}
        band={band}
        activeAttack={state.activeAttack}
        tab={tab}
        onTabChange={setTab}
      />

      <div className={styles.body}>
        <GlobeView
          satellites={satellites}
          landRings={landRings}
          threatIds={threatIdSet}
          selectedId={state.selectedSatelliteId}
          selectedSatellite={selectedSatellite}
          liveSample={liveSample}
          labelMode={labelMode}
          onLabelModeChange={setLabelMode}
          onSelect={handleSelect}
          counts={counts}
          status={status}
        />

        <aside className={styles.panel} aria-label="Threat intelligence panel">
          <MetricsPanel
            threatScore={state.threatScore}
            band={band}
            alertCount={state.alerts.length}
            satelliteCount={satellites.length}
            source={source}
            maxEpochAgeHours={maxEpochAgeHours}
            accuracyKm={accuracyKm}
            status={status}
            error={error}
            visibleSection={tab}
            counts={counts}
          />

          <ThreatSandbox
            activeAttack={state.activeAttack}
            attackCounts={state.attackCounts}
            phishStage={state.phishStage}
            onLaunch={launchAttack}
            onPhish={startPhishing}
            onReset={() => dispatch({ type: 'reset' })}
            hidden={tab === 'sources' || tab === 'threats'}
          />

          <AlertFeed alerts={state.alerts} />
        </aside>
      </div>
    </div>
  )
}

// ── Header ──────────────────────────────────────────────────────────────────

interface HeaderProps {
  readonly satelliteCount: number
  readonly band: 'LOW RISK' | 'ELEVATED' | 'CRITICAL'
  readonly activeAttack: AttackKind | null
  readonly tab: Tab
  readonly onTabChange: (tab: Tab) => void
}

function Header({ satelliteCount, band, activeAttack, tab, onTabChange }: HeaderProps): React.ReactElement {
  const badgeClass =
    band === 'CRITICAL' ? styles.badgeCritical : band === 'ELEVATED' ? styles.badgeWarn : styles.badge

  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        <ShieldIcon />
        <span className={styles.logoText}>
          AE<em>GIS</em>
        </span>
        <span className={styles.logoVersion}>v3.0</span>
        <span className={styles.logoTagline}>ORBITAL THREAT INTEL</span>
      </div>

      <nav className={styles.tabs} aria-label="Console sections">
        {/*
          Tabs are real buttons with roles and keyboard support. The legacy
          markup used <div onclick> with no role, tabindex, or key handling.
        */}
        <div role="tablist" className={styles.tabList}>
          {TABS.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              type="button"
              id={`tab-${entry.id}`}
              aria-selected={tab === entry.id}
              aria-controls="console-panel"
              className={tab === entry.id ? styles.tabActive : styles.tab}
              onClick={() => onTabChange(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </nav>

      <div className={styles.headerRight}>
        <span className={styles.pill}>
          <span className={styles.pillDot} aria-hidden="true" />
          <strong>{satelliteCount}</strong> sats live
        </span>
        <span
          className={badgeClass}
          role="status"
          aria-live="polite"
        >
          {activeAttack === null ? '● NOMINAL' : `⚠ ${band}`}
        </span>
        <Clock />
      </div>
    </header>
  )
}

function ShieldIcon(): React.ReactElement {
  return (
    <svg width="26" height="26" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path
        d="M14 2 L24 6 L24 15 Q24 22 14 26 Q4 22 4 15 L4 6 Z"
        stroke="#00d4a0"
        strokeWidth="1.2"
        fill="rgba(0,212,160,0.06)"
        opacity=".9"
      />
      <circle cx="14" cy="14" r="4" stroke="#00d4a0" strokeWidth="1" fill="none" opacity=".7" />
      <circle cx="14" cy="14" r="1.5" fill="#00d4a0" />
    </svg>
  )
}

/**
 * Dual UTC / local clock.
 *
 * The legacy build sent every visitor's IP to ipapi.co purely to render a city
 * name. `Intl.DateTimeFormat` already knows the timezone, so the third-party
 * request — and the privacy cost of it — is gone.
 */
function Clock(): React.ReactElement {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const interval = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return 'LOCAL'
    }
  }, [])

  const shortZone = timezone.split('/').pop()?.replace(/_/g, ' ').toUpperCase() ?? 'LOCAL'

  // Rendered only after mount so server and client markup agree.
  if (now === null) {
    return (
      <div className={styles.clock}>
        <span className={styles.clockRow}>
          <span className={styles.clockLabel}>UTC</span>
          <span className={styles.clockValue}>—</span>
        </span>
      </div>
    )
  }

  return (
    <div className={styles.clock}>
      <span className={styles.clockRow}>
        <span className={styles.clockLabel}>UTC</span>
        <time className={styles.clockValue} dateTime={now.toISOString()}>
          {now.toISOString().slice(11, 19)}
        </time>
      </span>
      <span className={styles.clockRow}>
        <span className={styles.clockLabel}>{shortZone.slice(0, 10)}</span>
        <span className={styles.clockValueDim}>
          {now.toLocaleTimeString('en-GB', { hour12: false })}
        </span>
      </span>
    </div>
  )
}
