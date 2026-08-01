import { NextResponse } from 'next/server'
import {
  fetchGroup,
  groupLabel,
  maxEpochAge,
  tleResponseSchema,
  type TleResponse,
} from '@/lib/orbital/celestrak'
import { fallbackRecords } from '@/lib/orbital/fallback'
import { SATELLITE_GROUPS, type SatelliteGroup } from '@/lib/orbital/types'

/**
 * Combined satellite feed — every group in one response.
 *
 * The console previously issued four parallel requests to /api/tle/[group].
 * On a cold cache those four raced Next's incremental cache for the same route
 * and some returned 500. One endpoint means one cache entry, one round trip,
 * and no race. The per-group routes remain available as a public API surface.
 */

export const revalidate = 3600

export interface SatellitesResponse {
  readonly fetchedAt: string
  readonly groups: readonly TleResponse[]
  /** Groups that failed and fell back, for observability in the UI. */
  readonly degraded: readonly SatelliteGroup[]
}

async function loadGroup(group: SatelliteGroup, now: Date): Promise<{ payload: TleResponse; degraded: boolean }> {
  try {
    const records = await fetchGroup(group)
    return {
      payload: {
        group,
        label: groupLabel(group),
        source: 'live',
        fetchedAt: now.toISOString(),
        maxEpochAgeHours: maxEpochAge(records, now),
        records: [...records],
      },
      degraded: false,
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: 'celestrak_fetch_failed',
        group,
        reason: error instanceof Error ? error.message : String(error),
      }),
    )

    const records = fallbackRecords(group)
    return {
      payload: {
        group,
        label: groupLabel(group),
        source: 'fallback',
        fetchedAt: now.toISOString(),
        maxEpochAgeHours: maxEpochAge(records, now),
        records: [...records],
      },
      degraded: true,
    }
  }
}

export async function GET(): Promise<NextResponse> {
  const now = new Date()

  // Outbound requests run in parallel; these are our own server's calls to a
  // single upstream, not four browsers racing a shared cache entry.
  const results = await Promise.all(SATELLITE_GROUPS.map((group) => loadGroup(group, now)))

  const groups: TleResponse[] = []
  const degraded: SatelliteGroup[] = []

  for (const result of results) {
    const validated = tleResponseSchema.safeParse(result.payload)
    if (!validated.success) {
      console.error(
        JSON.stringify({
          event: 'tle_response_invalid',
          group: result.payload.group,
          issues: validated.error.issues,
        }),
      )
      continue
    }
    groups.push(validated.data)
    if (result.degraded) degraded.push(result.payload.group)
  }

  if (groups.length === 0) {
    return NextResponse.json(
      { error: 'satellite data temporarily unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const body: SatellitesResponse = {
    fetchedAt: now.toISOString(),
    groups,
    degraded,
  }

  return NextResponse.json(body, {
    headers: {
      'Cache-Control':
        degraded.length === 0
          ? 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
          : 'public, max-age=60, s-maxage=300',
    },
  })
}
