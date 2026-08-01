import type { SatRec } from 'satellite.js'

/** Satellite groups AEGIS ingests from CelesTrak. */
export const SATELLITE_GROUPS = ['starlink', 'stations', 'gps', 'weather'] as const

export type SatelliteGroup = (typeof SATELLITE_GROUPS)[number]

/**
 * Orbital regime. The legacy implementation classified anything above MEO as
 * GEO, which mislabels Molniya and other highly elliptical orbits; HEO is
 * tracked separately here.
 */
export type OrbitType = 'LEO' | 'MEO' | 'GEO' | 'HEO'

/** A raw three-line element set, before SGP4 initialisation. */
export interface TleRecord {
  readonly name: string
  readonly line1: string
  readonly line2: string
  readonly noradId: number
}

/** A satellite with an initialised SGP4 propagator. */
export interface TrackedSatellite {
  readonly id: string
  readonly name: string
  readonly noradId: number
  readonly group: SatelliteGroup
  readonly orbitType: OrbitType
  readonly inclinationDeg: number
  readonly meanAltitudeKm: number
  readonly satrec: SatRec
}

/** Sub-satellite point plus scalar speed, in geodetic coordinates. */
export interface GeodeticPosition {
  readonly latitudeDeg: number
  readonly longitudeDeg: number
  readonly altitudeKm: number
  readonly velocityKmS: number
}

/** Provenance of the satellite set currently on screen. */
export type DataSourceKind = 'live' | 'fallback' | 'mixed'

export interface SatelliteSetMeta {
  readonly source: DataSourceKind
  readonly fetchedAt: string
  /** Age of the oldest TLE epoch in the set, in hours. Drives accuracy claims. */
  readonly maxEpochAgeHours: number
  readonly counts: Readonly<Record<SatelliteGroup, number>>
}
