'use client'

import { useEffect, useRef } from 'react'
import { detect } from '@/lib/detection/detector'
import type { TelemetrySample } from '@/lib/detection/telemetry'
import type { SatelliteGroup, TrackedSatellite } from '@/lib/orbital/types'
import { GlobeRenderer, type LabelMode, type LandRing } from '@/lib/renderer/globe-renderer'
import { GROUP_COLORS, GROUP_LABELS, PALETTE } from '@/lib/theme'
import styles from './GlobeView.module.css'

interface GlobeViewProps {
  readonly satellites: readonly TrackedSatellite[]
  readonly landRings: readonly LandRing[]
  readonly threatIds: ReadonlySet<string>
  readonly selectedId: string | null
  readonly selectedSatellite: TrackedSatellite | null
  readonly liveSample: TelemetrySample
  readonly labelMode: LabelMode
  readonly onLabelModeChange: (mode: LabelMode) => void
  readonly onSelect: (id: string | null) => void
  readonly counts: Readonly<Record<SatelliteGroup, number>>
  readonly status: 'loading' | 'ready' | 'error'
}

const LABEL_MODE_ORDER: readonly LabelMode[] = ['smart', 'all', 'none']
const LABEL_MODE_TEXT: Readonly<Record<LabelMode, string>> = {
  smart: 'SMART',
  all: 'ALL',
  none: 'OFF',
}

export function GlobeView(props: GlobeViewProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<GlobeRenderer | null>(null)

  /*
   * The renderer is constructed once, so it captures whatever `onSelect` was
   * current at mount. Keeping the latest callback in a ref lets selection
   * events reach the current handler without tearing down the renderer — but
   * the ref must be written in an effect, never during render.
   */
  const onSelectRef = useRef(props.onSelect)
  useEffect(() => {
    onSelectRef.current = props.onSelect
  }, [props.onSelect])

  /**
   * The renderer is constructed once and driven imperatively. Satellite
   * positions never enter React state — pushing 170 positions through a
   * setState at 60fps would dispatch roughly 10,000 updates per second.
   */
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return

    const renderer = new GlobeRenderer(canvas, {
      onSelect: (id) => onSelectRef.current(id),
    })
    rendererRef.current = renderer
    renderer.start()

    return () => {
      renderer.destroy()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    rendererRef.current?.setSatellites(props.satellites)
  }, [props.satellites])

  useEffect(() => {
    rendererRef.current?.setLandRings(props.landRings)
  }, [props.landRings])

  useEffect(() => {
    rendererRef.current?.setThreatIds(props.threatIds)
  }, [props.threatIds])

  useEffect(() => {
    rendererRef.current?.setSelectedId(props.selectedId)
  }, [props.selectedId])

  useEffect(() => {
    rendererRef.current?.setLabelMode(props.labelMode)
  }, [props.labelMode])

  const cycleLabelMode = (): void => {
    const index = LABEL_MODE_ORDER.indexOf(props.labelMode)
    const next = LABEL_MODE_ORDER[(index + 1) % LABEL_MODE_ORDER.length] ?? 'smart'
    props.onLabelModeChange(next)
  }

  const total = Object.values(props.counts).reduce((sum, value) => sum + value, 0)

  return (
    <div className={styles.wrapper}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        tabIndex={0}
        role="application"
        aria-label={
          `Interactive orbital globe showing ${props.satellites.length} tracked satellites. ` +
          'Drag or use arrow keys to rotate, scroll or press plus and minus to zoom, ' +
          'click or tap a satellite for telemetry.'
        }
      />

      {/* Text equivalent of the canvas contents for assistive technology. */}
      <p className="sr-only" aria-live="polite">
        {props.status === 'loading'
          ? 'Loading satellite data.'
          : `Tracking ${total} satellites: ${Object.entries(props.counts)
              .map(([group, count]) => `${count} ${GROUP_LABELS[group as SatelliteGroup]}`)
              .join(', ')}.` +
            (props.threatIds.size > 0 ? ` ${props.threatIds.size} assets flagged.` : '')}
      </p>

      <div className={styles.counts}>
        {(Object.keys(props.counts) as SatelliteGroup[]).map((group) => (
          <div key={group} className={styles.countRow}>
            <span className={styles.countKey}>{GROUP_LABELS[group]}</span>
            <span className={styles.countValue}>{props.counts[group] || '—'}</span>
          </div>
        ))}
        <div className={styles.countDivider} />
        <div className={styles.countRow}>
          <span className={styles.countTotalKey}>TOTAL</span>
          <span className={styles.countTotalValue}>{total}</span>
        </div>
      </div>

      <div className={styles.legend}>
        {(Object.keys(GROUP_COLORS) as SatelliteGroup[]).map((group) => (
          <span key={group} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: GROUP_COLORS[group] }} />
            {GROUP_LABELS[group]}
          </span>
        ))}
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: PALETTE.red }} />
          Threat
        </span>
        <button type="button" className={styles.legendToggle} onClick={cycleLabelMode}>
          Labels: {LABEL_MODE_TEXT[props.labelMode]}
        </button>
      </div>

      {props.selectedSatellite !== null && (
        <SatelliteDetail
          satellite={props.selectedSatellite}
          sample={props.liveSample}
          onClose={() => props.onSelect(null)}
        />
      )}
    </div>
  )
}

interface SatelliteDetailProps {
  readonly satellite: TrackedSatellite
  readonly sample: TelemetrySample
  readonly onClose: () => void
}

function SatelliteDetail({ satellite, sample, onClose }: SatelliteDetailProps): React.ReactElement {
  const detection = detect(sample)
  const color =
    detection.severity === 'critical'
      ? PALETTE.red
      : detection.severity === 'elevated'
        ? PALETTE.amber
        : PALETTE.green

  return (
    <section className={styles.detail} aria-label={`Telemetry for ${satellite.name}`}>
      <header className={styles.detailHeader}>
        <h2 className={styles.detailName}>{satellite.name}</h2>
        <button type="button" className={styles.detailClose} onClick={onClose} aria-label="Close telemetry panel">
          ✕
        </button>
      </header>

      <dl className={styles.detailList}>
        <Row label="NORAD" value={String(satellite.noradId)} />
        <Row label="Orbit" value={satellite.orbitType} />
        <Row label="Inclination" value={`${satellite.inclinationDeg.toFixed(2)}°`} />
        <Row label="Mean altitude" value={`${satellite.meanAltitudeKm.toFixed(0)} km`} />
      </dl>

      <div className={styles.detailDivider} />
      <p className={styles.detailSectionLabel}>
        Simulated telemetry
        <span className={styles.detailNote}>not measured from the spacecraft</span>
      </p>

      <dl className={styles.detailList}>
        <Row label="SNR" value={`${sample.snrDb.toFixed(1)} dB`} />
        <Row label="Command rate" value={`${sample.commandRatePerSec.toFixed(2)}/s`} />
        <Row label="Position Δ" value={`${sample.positionDeltaKm.toFixed(3)} km`} />
        <Row label="Signal" value={`${sample.signalStrengthDbm.toFixed(0)} dBm`} />
        <Row label="Packet loss" value={`${(sample.packetLossRatio * 100).toFixed(2)}%`} />
        <Row label="Nonce dupes" value={String(sample.nonceDuplicates)} />
      </dl>

      <div className={styles.detailScore}>
        <div>
          <p className={styles.detailSectionLabel}>Anomaly score</p>
          <p className={styles.detailScoreValue} style={{ color }}>
            {detection.displayScore.toFixed(0)}
          </p>
        </div>
        <div
          className={styles.detailScoreBar}
          role="meter"
          aria-valuenow={Math.round(detection.displayScore)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Isolation Forest anomaly score"
        >
          <div
            className={styles.detailScoreFill}
            style={{ width: `${detection.displayScore}%`, background: color }}
          />
        </div>
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className={styles.detailRow}>
      <dt className={styles.detailKey}>{label}</dt>
      <dd className={styles.detailValue}>{value}</dd>
    </div>
  )
}
