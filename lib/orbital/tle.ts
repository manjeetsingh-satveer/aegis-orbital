import type { TleRecord } from './types'

/**
 * TLE element lines are exactly 69 characters and carry a modulo-10 checksum in
 * column 69. Anything shorter is truncated or corrupt.
 */
const TLE_LINE_LENGTH = 69

export interface ParseTleOptions {
  /** Stop after this many valid records. */
  readonly limit?: number
  /** Reject lines whose modulo-10 checksum does not match. Default true. */
  readonly verifyChecksum?: boolean
}

export interface ParseTleResult {
  readonly records: readonly TleRecord[]
  /** Count of line groups rejected, by reason. Surfaced for observability. */
  readonly rejected: Readonly<Record<string, number>>
}

/**
 * TLE checksum: sum of digits, with '-' counting as 1 and all other characters
 * as 0, modulo 10. The expected value lives in the final column.
 */
export function tleChecksum(line: string): number {
  let sum = 0
  for (let i = 0; i < TLE_LINE_LENGTH - 1 && i < line.length; i += 1) {
    const char = line[i]
    if (char === undefined) continue
    if (char >= '0' && char <= '9') sum += char.charCodeAt(0) - 48
    else if (char === '-') sum += 1
  }
  return sum % 10
}

export function isValidElementLine(line: string, expectedNumber: 1 | 2, verifyChecksum: boolean): boolean {
  if (line.length < TLE_LINE_LENGTH) return false
  if (line[0] !== String(expectedNumber)) return false
  if (line[1] !== ' ') return false
  if (!verifyChecksum) return true
  const stated = line[TLE_LINE_LENGTH - 1]
  if (stated === undefined || stated < '0' || stated > '9') return false
  return tleChecksum(line) === Number(stated)
}

/** Satellite numbers occupy columns 3-7 of both element lines. */
function readNoradId(line1: string): number | null {
  const raw = line1.slice(2, 7).trim()
  if (!/^\d{1,5}$/.test(raw)) return null
  return Number.parseInt(raw, 10)
}

/** CelesTrak pads names to 24 characters and may prefix them with "0 ". */
function normaliseName(raw: string): string {
  return raw.replace(/^0\s+/, '').trim()
}

/**
 * Parses CelesTrak 3LE/2LE payloads.
 *
 * The legacy parser stepped through the input three lines at a time and used
 * `continue` on malformed groups, so a single missing line desynchronised every
 * record after it. This scans for valid line-1/line-2 pairs and advances one
 * line at a time when the window does not match, so corruption costs one record
 * rather than the remainder of the file.
 */
export function parseTle(text: string, options: ParseTleOptions = {}): ParseTleResult {
  const { limit = Number.POSITIVE_INFINITY, verifyChecksum = true } = options

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)

  const records: TleRecord[] = []
  const rejected: Record<string, number> = {}
  const reject = (reason: string): void => {
    rejected[reason] = (rejected[reason] ?? 0) + 1
  }

  let cursor = 0
  while (cursor < lines.length && records.length < limit) {
    const first = lines[cursor]
    const second = lines[cursor + 1]
    const third = lines[cursor + 2]

    if (first === undefined) break

    // Three-line form: name, then both element lines.
    if (
      second !== undefined &&
      third !== undefined &&
      isValidElementLine(second, 1, verifyChecksum) &&
      isValidElementLine(third, 2, verifyChecksum)
    ) {
      const noradId = readNoradId(second)
      if (noradId === null) {
        reject('unparsable-norad-id')
        cursor += 3
        continue
      }
      const name = normaliseName(first)
      records.push({ name: name.length > 0 ? name : `NORAD ${noradId}`, line1: second, line2: third, noradId })
      cursor += 3
      continue
    }

    // Two-line form: element lines with no preceding name.
    if (
      second !== undefined &&
      isValidElementLine(first, 1, verifyChecksum) &&
      isValidElementLine(second, 2, verifyChecksum)
    ) {
      const noradId = readNoradId(first)
      if (noradId === null) {
        reject('unparsable-norad-id')
        cursor += 2
        continue
      }
      records.push({ name: `NORAD ${noradId}`, line1: first, line2: second, noradId })
      cursor += 2
      continue
    }

    // No valid window here — advance a single line to resynchronise.
    reject('unmatched-line')
    cursor += 1
  }

  return { records, rejected }
}

/**
 * Decodes the epoch from element line 1 (columns 19-32) into a Date.
 * Two-digit years 57-99 map to the 1900s, 00-56 to the 2000s, per NORAD.
 */
export function tleEpoch(line1: string): Date | null {
  const raw = line1.slice(18, 32).trim()
  if (!/^\d{2}\d{1,3}(\.\d+)?$/.test(raw)) return null

  const twoDigitYear = Number.parseInt(raw.slice(0, 2), 10)
  const dayOfYear = Number.parseFloat(raw.slice(2))
  if (!Number.isFinite(dayOfYear) || dayOfYear < 1) return null

  const year = twoDigitYear >= 57 ? 1900 + twoDigitYear : 2000 + twoDigitYear
  const startOfYear = Date.UTC(year, 0, 1)
  return new Date(startOfYear + (dayOfYear - 1) * 86_400_000)
}

/** Age of a TLE epoch in hours. SGP4 error grows roughly 1-3 km per day from here. */
export function tleAgeHours(line1: string, now: Date = new Date()): number | null {
  const epoch = tleEpoch(line1)
  if (epoch === null) return null
  return (now.getTime() - epoch.getTime()) / 3_600_000
}
