'use client'

import type { AttackKind } from '@/lib/detection/telemetry'
import { ATTACK_DEFINITIONS, PHISH_STAGES } from '@/lib/simulation/reducer'
import { ATTACK_COLORS } from '@/lib/theme'
import styles from './ThreatSandbox.module.css'

interface ThreatSandboxProps {
  readonly activeAttack: AttackKind | null
  readonly attackCounts: Readonly<Record<AttackKind, number>>
  readonly phishStage: number | null
  readonly onLaunch: (kind: Exclude<AttackKind, 'phish'>) => void
  readonly onPhish: () => void
  readonly onReset: () => void
  readonly hidden: boolean
}

const SIMPLE_ATTACKS: readonly { readonly kind: Exclude<AttackKind, 'phish'>; readonly glyph: string }[] = [
  { kind: 'spoof', glyph: '⊛' },
  { kind: 'jam', glyph: '≋' },
  { kind: 'inject', glyph: '⌘' },
  { kind: 'replay', glyph: '↻' },
]

export function ThreatSandbox(props: ThreatSandboxProps): React.ReactElement | null {
  if (props.hidden) return null

  const maxCount = Math.max(1, ...Object.values(props.attackCounts))
  const isPhishing = props.phishStage !== null

  return (
    <section className={styles.section} id="sandbox" aria-label="Threat simulation sandbox">
      <header className={styles.header}>
        <h2 className={styles.title}>Threat Sandbox</h2>
        {/* Stable hook for E2E: CSS module class names are hashed per build. */}
        <span className={styles.status} data-testid="sandbox-status">
          {isPhishing
            ? `PHISH ${(props.phishStage ?? 0) + 1}/${PHISH_STAGES.length}`
            : props.activeAttack !== null
              ? 'ACTIVE'
              : 'STANDBY'}
        </span>
      </header>

      <div className={styles.grid}>
        {SIMPLE_ATTACKS.map(({ kind, glyph }) => {
          const definition = ATTACK_DEFINITIONS[kind]
          const isActive = props.activeAttack === kind
          return (
            <button
              key={kind}
              type="button"
              className={isActive ? styles.buttonActive : styles.button}
              style={isActive ? { borderColor: ATTACK_COLORS[kind], color: ATTACK_COLORS[kind] } : undefined}
              onClick={() => props.onLaunch(kind)}
              aria-pressed={isActive}
            >
              <span className={styles.glyph} aria-hidden="true">
                {glyph}
              </span>
              <span className={styles.buttonLabel}>{definition.label}</span>
              <span className={styles.severity} style={{ color: ATTACK_COLORS[kind] }}>
                {definition.severity}
              </span>
            </button>
          )
        })}

        <button
          type="button"
          className={isPhishing ? styles.phishButtonActive : styles.phishButton}
          onClick={props.onPhish}
          aria-pressed={isPhishing}
        >
          <span className={styles.glyph} aria-hidden="true">
            ⚲
          </span>
          <span className={styles.buttonLabel}>Ground Station Phishing</span>
          <span className={styles.severity} style={{ color: ATTACK_COLORS.phish }}>
            CRITICAL
          </span>
        </button>

        <button type="button" className={styles.resetButton} onClick={props.onReset}>
          ↺ Reset simulation
        </button>
      </div>

      <div className={styles.bars}>
        {(Object.keys(ATTACK_DEFINITIONS) as AttackKind[]).map((kind) => {
          const count = props.attackCounts[kind] ?? 0
          return (
            <div key={kind} className={styles.bar}>
              <span className={styles.barLabel} style={{ color: ATTACK_COLORS[kind] }}>
                {ATTACK_DEFINITIONS[kind].label}
              </span>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{
                    width: `${Math.round((count / maxCount) * 100)}%`,
                    background: ATTACK_COLORS[kind],
                  }}
                />
              </div>
              <span className={styles.barCount} data-testid="attack-count">
                {count}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
