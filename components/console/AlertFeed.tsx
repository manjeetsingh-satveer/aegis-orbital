'use client'

import type { Alert } from '@/lib/simulation/types'
import { ATTACK_COLORS } from '@/lib/theme'
import styles from './AlertFeed.module.css'

interface AlertFeedProps {
  readonly alerts: readonly Alert[]
}

export function AlertFeed({ alerts }: AlertFeedProps): React.ReactElement {
  return (
    <section className={styles.section} aria-label="Alert feed">
      <header className={styles.header}>
        <h2 className={styles.title}>Alert Feed</h2>
        <span className={styles.count}>
          {alerts.length} event{alerts.length === 1 ? '' : 's'}
        </span>
      </header>

      {/*
        aria-live announces new detections to screen readers. `polite` so it
        waits for a pause rather than interrupting.
      */}
      <ol className={styles.list} aria-live="polite" aria-relevant="additions">
        {alerts.length === 0 && (
          <li className={styles.empty}>AEGIS nominal — all orbital assets secure</li>
        )}

        {alerts.map((alert) => (
          <li
            key={alert.id}
            className={alert.severity === 'CRITICAL' ? styles.itemCritical : styles.itemWarning}
            style={{ borderLeftColor: ATTACK_COLORS[alert.kind] }}
          >
            <div className={styles.itemHeader}>
              <span className={styles.itemLabel} style={{ color: ATTACK_COLORS[alert.kind] }}>
                {/*
                  Severity is spelled out rather than conveyed by colour alone,
                  so the feed is readable without colour perception.
                */}
                [{alert.severity}] {alert.label}
              </span>
              <span className={styles.itemSequence}>#{alert.sequence}</span>
            </div>

            <p className={styles.itemDescription}>{alert.description}</p>
            {alert.detail !== undefined && <p className={styles.itemDetail}>{alert.detail}</p>}

            <div className={styles.features}>
              <span className={styles.feature}>SNR {alert.sample.snrDb.toFixed(1)}dB</span>
              <span className={styles.feature}>CMD {alert.sample.commandRatePerSec.toFixed(2)}/s</span>
              <span className={styles.feature}>Δ{alert.sample.positionDeltaKm.toFixed(3)}km</span>
              <span className={styles.feature}>
                PKT {(alert.sample.packetLossRatio * 100).toFixed(1)}%
              </span>
            </div>

            <p className={styles.itemMeta}>
              {alert.targetNames.length > 0 && <>Targets: {alert.targetNames.join(', ')} · </>}
              {/*
                The detector's actual verdict, including when it failed to flag —
                the phishing chain's early stages read "not flagged", which is
                the honest and more interesting result.
              */}
              score {alert.detection.displayScore.toFixed(0)}
              {alert.detection.flagged ? ' · flagged' : ' · below threshold'} ·{' '}
              <time dateTime={alert.occurredAt}>{alert.occurredAt.slice(11, 19)} UTC</time>
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}
