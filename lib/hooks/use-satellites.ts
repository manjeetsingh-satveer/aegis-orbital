'use client'

import { useEffect, useMemo, useState } from 'react'
import { initSatellite } from '@/lib/orbital/propagate'
import { type SatelliteGroup, type TrackedSatellite } from '@/lib/orbital/types'
import type { TleResponse } from '@/lib/orbital/celestrak'
import type { SatellitesResponse } from '@/app/api/satellites/route'

export type LoadStatus = 'loading' | 'ready' | 'error'

export interface SatelliteData {
  readonly satellites: readonly TrackedSatellite[]
  readonly status: LoadStatus
  readonly counts: Readonly<Record<SatelliteGroup, number>>
  /** True when every group came from live CelesTrak data. */
  readonly source: 'live' | 'fallback' | 'mixed' | 'unknown'
  /** Age of the stalest element set, in hours. */
  readonly maxEpochAgeHours: number
  readonly error: string | null
}

const EMPTY_COUNTS: Record<SatelliteGroup, number> = {
  starlink: 0,
  stations: 0,
  gps: 0,
  weather: 0,
}

/**
 * Loads satellite sets from our own API route.
 *
 * All the CORS-proxy fallback logic the legacy client carried is gone: the
 * server does the fetching, so this is a single same-origin request per group.
 */
export function useSatellites(): SatelliteData {
  const [responses, setResponses] = useState<readonly TleResponse[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        // A single combined request: four parallel calls to the per-group route
        // raced Next's incremental cache on a cold start and some returned 500.
        const response = await fetch('/api/satellites', { signal: controller.signal })
        if (!response.ok) throw new Error(`satellites endpoint returned ${response.status}`)

        const body = (await response.json()) as SatellitesResponse
        if (controller.signal.aborted) return

        if (body.groups.length === 0) {
          setStatus('error')
          setError('Unable to load satellite data.')
          return
        }

        setResponses(body.groups)
        setStatus('ready')
        setError(
          body.degraded.length > 0
            ? `Live feed unavailable for ${body.degraded.join(', ')} — using the bundled snapshot.`
            : null,
        )
      } catch (cause) {
        if (controller.signal.aborted) return
        setStatus('error')
        setError(cause instanceof Error ? cause.message : 'Unable to load satellite data.')
      }
    }

    void load()
    return () => controller.abort()
  }, [])

  return useMemo(() => {
    const satellites: TrackedSatellite[] = []
    const counts = { ...EMPTY_COUNTS }
    let maxEpochAgeHours = 0
    let sawLive = false
    let sawFallback = false

    for (const response of responses) {
      if (response.source === 'live') sawLive = true
      else sawFallback = true
      maxEpochAgeHours = Math.max(maxEpochAgeHours, response.maxEpochAgeHours)

      for (const record of response.records) {
        const satellite = initSatellite(record, response.group)
        // Elements SGP4 rejects are dropped rather than kept as a satrec that
        // throws on every frame.
        if (satellite === null) continue
        satellites.push(satellite)
        counts[response.group] += 1
      }
    }

    const source =
      responses.length === 0
        ? ('unknown' as const)
        : sawLive && sawFallback
          ? ('mixed' as const)
          : sawLive
            ? ('live' as const)
            : ('fallback' as const)

    return { satellites, status, counts, source, maxEpochAgeHours, error }
  }, [responses, status, error])
}

/** Coastline geometry for the globe, fetched once from our own route. */
export function useLandRings(): readonly (readonly (readonly [number, number])[])[] {
  const [rings, setRings] = useState<(readonly [number, number])[][]>([])

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/geo', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('geo failed'))))
      .then((data: { rings: [number, number][][] }) => {
        if (!controller.signal.aborted) setRings(data.rings)
      })
      .catch(() => {
        // The globe renders without coastlines; not worth surfacing to the user.
      })

    return () => controller.abort()
  }, [])

  return rings
}
