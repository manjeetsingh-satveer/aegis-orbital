import { z } from 'zod'
import { parseTle, tleAgeHours } from './tle'
import { SATELLITE_GROUPS, type SatelliteGroup, type TleRecord } from './types'

/**
 * CelesTrak ingest.
 *
 * Runs server-side only. The legacy build fetched CelesTrak from the browser
 * and, when CORS failed, fell through to api.allorigins.win and corsproxy.io —
 * third parties who could return arbitrary bytes that were then interpolated
 * into innerHTML. Server-to-server removes the CORS constraint entirely, so
 * there are no proxies and a single trusted origin.
 */

const CELESTRAK_ORIGIN = 'https://celestrak.org'

/**
 * Allowlist mapping our group names to CelesTrak's. User input never reaches
 * the outbound URL: an unrecognised group is rejected before any fetch, which
 * is what keeps this route from becoming an SSRF pivot.
 */
const GROUP_CONFIG: Readonly<
  Record<SatelliteGroup, { readonly celestrakGroup: string; readonly maxRecords: number; readonly label: string }>
> = {
  starlink: { celestrakGroup: 'starlink', maxRecords: 100, label: 'SpaceX Starlink LEO' },
  stations: { celestrakGroup: 'stations', maxRecords: 20, label: 'Crewed Space Stations' },
  gps: { celestrakGroup: 'gps-ops', maxRecords: 32, label: 'USAF GPS Constellation' },
  weather: { celestrakGroup: 'weather', maxRecords: 25, label: 'NOAA Weather & Earth Observation' },
}

export const satelliteGroupSchema = z.enum(SATELLITE_GROUPS)

export function isSatelliteGroup(value: string): value is SatelliteGroup {
  return satelliteGroupSchema.safeParse(value).success
}

export function groupLabel(group: SatelliteGroup): string {
  return GROUP_CONFIG[group].label
}

export function maxRecordsFor(group: SatelliteGroup): number {
  return GROUP_CONFIG[group].maxRecords
}

/**
 * Names come from a remote feed, so they are treated as untrusted: control
 * characters stripped, angle brackets removed, length capped. React escapes
 * output by default, but these strings are also drawn onto a canvas and used in
 * ARIA labels, where no framework is protecting us.
 */
export function sanitiseSatelliteName(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 32)
}

export const tleRecordSchema = z.object({
  name: z.string().min(1).max(32),
  line1: z.string().length(69),
  line2: z.string().length(69),
  noradId: z.number().int().min(0).max(99_999),
})

export const tleResponseSchema = z.object({
  group: satelliteGroupSchema,
  label: z.string(),
  source: z.enum(['live', 'fallback']),
  fetchedAt: z.string(),
  maxEpochAgeHours: z.number(),
  records: z.array(tleRecordSchema),
})

export type TleResponse = z.infer<typeof tleResponseSchema>

export class CelestrakError extends Error {
  constructor(message: string, cause?: unknown) {
    // Error.cause is standard in ES2022; redeclaring it as a field would shadow
    // the built-in property.
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'CelestrakError'
  }
}

export interface FetchOptions {
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

/**
 * Fetches and parses one CelesTrak group. Throws CelestrakError on transport
 * failure, a non-200 response, or a payload containing no valid elements —
 * the last case catches CDN error pages served with a 200.
 */
export async function fetchGroup(group: SatelliteGroup, options: FetchOptions = {}): Promise<TleRecord[]> {
  const { timeoutMs = 8000, signal } = options
  const config = GROUP_CONFIG[group]

  const url = new URL('/NORAD/elements/gp.php', CELESTRAK_ORIGIN)
  url.searchParams.set('GROUP', config.celestrakGroup)
  url.searchParams.set('FORMAT', 'tle')

  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetch(url, {
      signal: combined,
      headers: {
        // CelesTrak asks clients to identify themselves.
        'User-Agent': 'AEGIS-Orbital/3.0 (+https://github.com/manjeetsingh-satveer/aegis-orbital)',
        Accept: 'text/plain',
      },
    })
  } catch (error) {
    throw new CelestrakError(`network failure fetching group "${group}"`, error)
  }

  if (!response.ok) {
    throw new CelestrakError(`CelesTrak returned ${response.status} for group "${group}"`)
  }

  const body = await response.text()
  const { records, rejected } = parseTle(body, { limit: config.maxRecords })

  if (records.length === 0) {
    throw new CelestrakError(
      `no valid elements in CelesTrak response for "${group}" (rejected: ${JSON.stringify(rejected)})`,
    )
  }

  return records.map((record) => ({ ...record, name: sanitiseSatelliteName(record.name) }))
}

/** Age of the stalest TLE in a set, in hours. Drives the accuracy the UI reports. */
export function maxEpochAge(records: readonly TleRecord[], now: Date = new Date()): number {
  let oldest = 0
  for (const record of records) {
    const age = tleAgeHours(record.line1, now)
    if (age !== null && age > oldest) oldest = age
  }
  return oldest
}
