import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CelestrakError,
  fetchGroup,
  groupLabel,
  isSatelliteGroup,
  maxEpochAge,
  maxRecordsFor,
  sanitiseSatelliteName,
  tleResponseSchema,
} from './celestrak'

const L1 = '1 25544U 98067A   24160.52083333  .00016717  00000-0  30777-3 0  9001'
const L2 = '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49815294 25217'
const PAYLOAD = `ISS (ZARYA)\n${L1}\n${L2}\n`

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sanitiseSatelliteName', () => {
  /*
   * Security-critical. These names arrive from a remote feed and are drawn onto
   * a canvas and used in ARIA labels, neither of which any framework escapes.
   * In the legacy build they also reached innerHTML unescaped.
   */
  it('strips angle brackets', () => {
    expect(sanitiseSatelliteName('<script>alert(1)</script>')).toBe('scriptalert(1)/script')
    expect(sanitiseSatelliteName('SAT <img src=x onerror=1>')).toBe('SAT img src=x onerror=1')
  })

  it('strips control characters', () => {
    expect(sanitiseSatelliteName('ISS\u0000\u0007 (ZARYA)')).toBe('ISS (ZARYA)')
    expect(sanitiseSatelliteName('SAT\u001BNAME')).toBe('SATNAME')
  })

  it('caps length so a hostile feed cannot blow out the layout', () => {
    expect(sanitiseSatelliteName('A'.repeat(500))).toHaveLength(32)
  })

  it('trims the padding CelesTrak applies to names', () => {
    expect(sanitiseSatelliteName('ISS (ZARYA)            ')).toBe('ISS (ZARYA)')
  })

  it('leaves ordinary names untouched', () => {
    expect(sanitiseSatelliteName('GPS BIIR-5  (PRN 22)')).toBe('GPS BIIR-5  (PRN 22)')
  })
})

describe('group helpers', () => {
  it('accepts only known groups', () => {
    expect(isSatelliteGroup('starlink')).toBe(true)
    expect(isSatelliteGroup('gps')).toBe(true)
    // The allowlist is what stops user input reaching an outbound URL.
    expect(isSatelliteGroup('../../etc/passwd')).toBe(false)
    expect(isSatelliteGroup('https://evil.example')).toBe(false)
    expect(isSatelliteGroup('')).toBe(false)
  })

  it('exposes a label and record cap per group', () => {
    expect(groupLabel('stations')).toMatch(/Station/i)
    expect(maxRecordsFor('starlink')).toBeGreaterThan(0)
  })
})

describe('maxEpochAge', () => {
  it('reports the age of the stalest element set', () => {
    const epochPlusTwoDays = new Date(Date.UTC(2024, 5, 10, 12, 30))
    const age = maxEpochAge([{ name: 'ISS', line1: L1, line2: L2, noradId: 25544 }], epochPlusTwoDays)
    expect(age).toBeCloseTo(48, 0)
  })

  it('is zero for an empty set', () => {
    expect(maxEpochAge([])).toBe(0)
  })
})

describe('fetchGroup', () => {
  it('parses a successful response and sanitises names', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(`ISS <b>(ZARYA)</b>\n${L1}\n${L2}`, { status: 200 })),
    )

    const records = await fetchGroup('stations')
    expect(records).toHaveLength(1)
    expect(records[0]?.noradId).toBe(25544)
    expect(records[0]?.name).not.toMatch(/[<>]/)
  })

  it('requests only the allowlisted CelesTrak origin', async () => {
    const spy = vi.fn().mockResolvedValue(new Response(PAYLOAD, { status: 200 }))
    vi.stubGlobal('fetch', spy)

    await fetchGroup('gps')

    const url = new URL(String(spy.mock.calls[0]?.[0]))
    expect(url.origin).toBe('https://celestrak.org')
    expect(url.searchParams.get('GROUP')).toBe('gps-ops')
    expect(url.searchParams.get('FORMAT')).toBe('tle')
  })

  it('throws on a non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 })))
    await expect(fetchGroup('starlink')).rejects.toThrow(CelestrakError)
  })

  it('throws on a transport failure and preserves the cause', async () => {
    const cause = new Error('ECONNRESET')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause))

    const error = await fetchGroup('weather').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CelestrakError)
    expect((error as CelestrakError).cause).toBe(cause)
  })

  // A CDN error page served with a 200 must not be mistaken for satellite data.
  it('throws when a 200 response contains no valid elements', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>service unavailable</html>', { status: 200 })),
    )
    await expect(fetchGroup('stations')).rejects.toThrow(/no valid elements/)
  })

  it('honours the record cap for the group', async () => {
    const many = Array.from({ length: 200 }, () => PAYLOAD).join('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(many, { status: 200 })))

    const records = await fetchGroup('stations')
    expect(records.length).toBeLessThanOrEqual(maxRecordsFor('stations'))
  })
})

describe('tleResponseSchema', () => {
  const valid = {
    group: 'stations',
    label: 'Crewed Space Stations',
    source: 'live',
    fetchedAt: new Date().toISOString(),
    maxEpochAgeHours: 12,
    records: [{ name: 'ISS (ZARYA)', line1: L1, line2: L2, noradId: 25544 }],
  }

  it('accepts a well-formed payload', () => {
    expect(tleResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects element lines of the wrong width', () => {
    const bad = { ...valid, records: [{ ...valid.records[0]!, line1: 'too short' }] }
    expect(tleResponseSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects an unknown group', () => {
    expect(tleResponseSchema.safeParse({ ...valid, group: 'martian' }).success).toBe(false)
  })

  it('rejects an over-long name', () => {
    const bad = { ...valid, records: [{ ...valid.records[0]!, name: 'A'.repeat(64) }] }
    expect(tleResponseSchema.safeParse(bad).success).toBe(false)
  })
})
