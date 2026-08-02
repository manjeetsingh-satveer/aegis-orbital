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

const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 400

/** 5xx and 429 are worth retrying; 4xx generally is not. */
function isRetryable(status: number): boolean {
  return status >= 500 || status === 429
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('aborted', 'AbortError'))
      },
      { once: true },
    )
  })

/**
 * Fetch with bounded exponential backoff and jitter.
 *
 * Upstream data sources are not always available — CelesTrak rate-limited us
 * with 403s during development, and a cold serverless instance can fail its
 * first request. One transient failure should not leave the console empty for
 * the whole session.
 */
async function fetchWithRetry(url: string, signal: AbortSignal): Promise<Response> {
  let lastError: Error = new Error('request never attempted')

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      // Jitter prevents every open tab retrying on the same beat.
      const delay = BASE_BACKOFF_MS * 2 ** (attempt - 1) * (0.5 + Math.random())
      await sleep(delay, signal)
    }

    try {
      const response = await fetch(url, { signal })
      if (response.ok) return response

      lastError = new Error(`${url} returned ${response.status}`)
      if (!isRetryable(response.status)) throw lastError
    } catch (cause) {
      // An abort is intentional and must not be retried.
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
      lastError = cause instanceof Error ? cause : new Error(String(cause))
    }
  }

  throw lastError
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
        const response = await fetchWithRetry('/api/satellites', controller.signal)

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
