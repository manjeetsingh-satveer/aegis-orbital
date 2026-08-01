/**
 * Regenerates lib/orbital/fallback-tles.json from live CelesTrak data.
 *
 * The legacy build shipped 73 hand-written TLEs, several with obviously
 * synthetic elements (RAAN exactly 60.0000, argument of perigee exactly
 * 90.0000) and epochs that silently went stale. This snapshot contains real
 * elements with valid checksums, stamped with the date they were captured, so
 * the UI can report how old the fallback is instead of claiming a fixed
 * accuracy forever.
 *
 * Run `npm run refresh:fallback` periodically — a stale snapshot degrades
 * gracefully but the reported accuracy widens.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchGroup } from '../lib/orbital/celestrak'
import { SATELLITE_GROUPS, type SatelliteGroup, type TleRecord } from '../lib/orbital/types'

/** Fallback caps, kept below the live limits to bound bundle size. */
const FALLBACK_LIMITS: Record<SatelliteGroup, number> = {
  starlink: 40,
  stations: 20,
  gps: 32,
  weather: 25,
}

const groups: Partial<Record<SatelliteGroup, TleRecord[]>> = {}

for (const group of SATELLITE_GROUPS) {
  process.stdout.write(`fetching ${group}... `)
  try {
    const records = await fetchGroup(group, { timeoutMs: 20_000 })
    groups[group] = records.slice(0, FALLBACK_LIMITS[group])
    process.stdout.write(`${groups[group]?.length ?? 0} records\n`)
  } catch (error) {
    process.stderr.write(`FAILED: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

const total = Object.values(groups).reduce((sum, records) => sum + (records?.length ?? 0), 0)
if (total === 0) {
  process.stderr.write('no records fetched; refusing to write an empty snapshot\n')
  process.exit(1)
}

const outputPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'lib',
  'orbital',
  'fallback-tles.json',
)

writeFileSync(
  outputPath,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), groups }, null, 2)}\n`,
  'utf8',
)

process.stdout.write(`\nwrote ${total} records to ${outputPath}\n`)
