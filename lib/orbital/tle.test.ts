import { describe, expect, it } from 'vitest'
import { isValidElementLine, parseTle, tleAgeHours, tleChecksum, tleEpoch } from './tle'

// Real ISS elements. Checksums are genuine, so these exercise the strict path.
const ISS_NAME = 'ISS (ZARYA)'
const ISS_L1 = '1 25544U 98067A   24160.52083333  .00016717  00000-0  30777-3 0  9001'
const ISS_L2 = '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49815294 25217'

const THREE_LINE = `${ISS_NAME}\n${ISS_L1}\n${ISS_L2}\n`

describe('tleChecksum', () => {
  it('computes the modulo-10 digit sum with dashes counting as one', () => {
    // Trailing digit of a valid line is its own checksum.
    expect(tleChecksum(ISS_L1)).toBe(Number(ISS_L1[68]))
    expect(tleChecksum(ISS_L2)).toBe(Number(ISS_L2[68]))
  })
})

describe('isValidElementLine', () => {
  it('accepts correctly numbered lines', () => {
    expect(isValidElementLine(ISS_L1, 1, true)).toBe(true)
    expect(isValidElementLine(ISS_L2, 2, true)).toBe(true)
  })

  it('rejects a line claiming the wrong element number', () => {
    expect(isValidElementLine(ISS_L1, 2, true)).toBe(false)
  })

  it('rejects truncated lines', () => {
    expect(isValidElementLine(ISS_L1.slice(0, 40), 1, true)).toBe(false)
  })

  it('rejects a corrupted line when checksums are verified', () => {
    const corrupted = `${ISS_L1.slice(0, 30)}9${ISS_L1.slice(31)}`
    expect(isValidElementLine(corrupted, 1, true)).toBe(false)
    expect(isValidElementLine(corrupted, 1, false)).toBe(true)
  })
})

describe('parseTle', () => {
  it('parses a three-line set', () => {
    const { records } = parseTle(THREE_LINE)
    expect(records).toHaveLength(1)
    expect(records[0]?.name).toBe(ISS_NAME)
    expect(records[0]?.noradId).toBe(25544)
  })

  it('parses a two-line set with a synthesised name', () => {
    const { records } = parseTle(`${ISS_L1}\n${ISS_L2}\n`)
    expect(records).toHaveLength(1)
    expect(records[0]?.name).toBe('NORAD 25544')
  })

  it('strips the "0 " prefix CelesTrak uses on some feeds', () => {
    const { records } = parseTle(`0 ${ISS_NAME}\n${ISS_L1}\n${ISS_L2}`)
    expect(records[0]?.name).toBe(ISS_NAME)
  })

  it('handles CRLF line endings', () => {
    const { records } = parseTle(`${ISS_NAME}\r\n${ISS_L1}\r\n${ISS_L2}\r\n`)
    expect(records).toHaveLength(1)
  })

  // This is the regression the legacy three-at-a-time parser could not survive:
  // one stray line desynchronised every record that followed it.
  it('resynchronises after a corrupt group instead of losing the remainder', () => {
    const input = ['GARBAGE SATELLITE', 'this is not an element line', THREE_LINE].join('\n')
    const { records } = parseTle(input)
    expect(records).toHaveLength(1)
    expect(records[0]?.noradId).toBe(25544)
  })

  it('recovers when a single line is missing mid-file', () => {
    const input = ['SAT ONE', ISS_L1, 'SAT TWO', ISS_NAME, ISS_L1, ISS_L2].join('\n')
    const { records } = parseTle(input)
    expect(records).toHaveLength(1)
    expect(records[0]?.name).toBe(ISS_NAME)
  })

  it('respects the record limit', () => {
    const many = Array.from({ length: 10 }, () => THREE_LINE).join('')
    const { records } = parseTle(many, { limit: 3 })
    expect(records).toHaveLength(3)
  })

  it('returns no records for empty or junk input', () => {
    expect(parseTle('').records).toHaveLength(0)
    expect(parseTle('\n\n   \n').records).toHaveLength(0)
    expect(parseTle('<!DOCTYPE html><html>proxy error</html>').records).toHaveLength(0)
  })

  it('reports rejection reasons for observability', () => {
    const { rejected } = parseTle('nonsense line one\nnonsense line two')
    expect(rejected['unmatched-line']).toBe(2)
  })
})

describe('tleEpoch', () => {
  it('decodes a 2024 epoch', () => {
    const epoch = tleEpoch(ISS_L1)
    expect(epoch).not.toBeNull()
    expect(epoch?.getUTCFullYear()).toBe(2024)
    // Day 160.52083333 of 2024 is 8 June, 12:30 UTC.
    expect(epoch?.getUTCMonth()).toBe(5)
    expect(epoch?.getUTCDate()).toBe(8)
    expect(epoch?.getUTCHours()).toBe(12)
  })

  it('maps two-digit years 57-99 to the 1900s', () => {
    const line = `1 00005U 58002B   58001.00000000  .00000000  00000-0  00000-0 0  9994`
    expect(tleEpoch(line)?.getUTCFullYear()).toBe(1958)
  })

  it('returns null for a malformed epoch field', () => {
    expect(tleEpoch('1 25544U 98067A   ??????????????  .00016717')).toBeNull()
  })
})

describe('tleAgeHours', () => {
  it('measures age against a supplied clock', () => {
    const epoch = tleEpoch(ISS_L1)!
    const later = new Date(epoch.getTime() + 48 * 3_600_000)
    expect(tleAgeHours(ISS_L1, later)).toBeCloseTo(48, 5)
  })
})
