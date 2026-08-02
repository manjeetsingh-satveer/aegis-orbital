import { NextResponse } from 'next/server'
import { enforceRateLimit } from '@/lib/api/rate-limit-gate'
import {
  CelestrakError,
  fetchGroup,
  groupLabel,
  isSatelliteGroup,
  maxEpochAge,
  tleResponseSchema,
  type TleResponse,
} from '@/lib/orbital/celestrak'
import { fallbackRecords } from '@/lib/orbital/fallback'
import { SATELLITE_GROUPS } from '@/lib/orbital/types'

/**
 * Cached CelesTrak proxy.
 *
 * This route is why the migration was worth doing. In the legacy build every
 * visitor's browser hit CelesTrak four times and, on CORS failure, fell through
 * to api.allorigins.win and corsproxy.io — untrusted third parties whose
 * response text was interpolated into innerHTML. Here the fetch is
 * server-to-server (no CORS constraint, so no proxies), the response is parsed
 * and validated before it leaves the server, and the result is cached so
 * CelesTrak sees one request per group per hour rather than one per visitor.
 */

/*
 * Dynamic for the same reason as /api/satellites: a cached route handler does
 * not execute per request, so the rate-limit gate would be inert. The upstream
 * CelesTrak fetch carries the hourly cache instead.
 */
export const dynamic = 'force-dynamic'

/** Only the four known groups exist as routes; anything else 404s. */
export const dynamicParams = false

export function generateStaticParams(): { group: string }[] {
  return SATELLITE_GROUPS.map((group) => ({ group }))
}

export async function GET(
  request: Request,
  context: { params: Promise<{ group: string }> },
): Promise<NextResponse> {
  const gate = enforceRateLimit(request)
  if (gate.rejection !== null) return gate.rejection

  const { group } = await context.params

  // Defence in depth: dynamicParams=false already rejects unknown groups, but
  // the allowlist check is what guarantees user input never reaches an
  // outbound URL.
  if (!isSatelliteGroup(group)) {
    return NextResponse.json(
      { error: 'unknown satellite group' },
      { status: 404, headers: gate.headers },
    )
  }

  const now = new Date()
  let payload: TleResponse

  try {
    const records = await fetchGroup(group)
    payload = {
      group,
      label: groupLabel(group),
      source: 'live',
      fetchedAt: now.toISOString(),
      maxEpochAgeHours: maxEpochAge(records, now),
      records: [...records],
    }
  } catch (error) {
    // Structured log; the client gets a working response either way.
    console.warn(
      JSON.stringify({
        event: 'celestrak_fetch_failed',
        group,
        reason: error instanceof CelestrakError ? error.message : String(error),
      }),
    )

    const records = fallbackRecords(group)
    if (records.length === 0) {
      return NextResponse.json(
        { error: 'satellite data temporarily unavailable' },
        { status: 503, headers: { ...gate.headers, 'Cache-Control': 'no-store' } },
      )
    }

    payload = {
      group,
      label: groupLabel(group),
      source: 'fallback',
      fetchedAt: now.toISOString(),
      maxEpochAgeHours: maxEpochAge(records, now),
      records: [...records],
    }
  }

  // Validate our own output. If a parser change ever produces a malformed
  // record, this fails here rather than in the browser.
  const validated = tleResponseSchema.safeParse(payload)
  if (!validated.success) {
    console.error(
      JSON.stringify({ event: 'tle_response_invalid', group, issues: validated.error.issues }),
    )
    return NextResponse.json(
      { error: 'internal validation failure' },
      { status: 500, headers: { ...gate.headers, 'Cache-Control': 'no-store' } },
    )
  }

  return NextResponse.json(validated.data, {
    headers: {
      ...gate.headers,
      'Cache-Control':
        payload.source === 'live'
          ? 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
          : 'public, max-age=60, s-maxage=300',
    },
  })
}
