import * as satellite from 'satellite.js'
import type { GeodeticPosition, OrbitType, SatelliteGroup, TleRecord, TrackedSatellite } from './types'

/** Earth's gravitational parameter, km^3/s^2 (WGS-72, matching SGP4). */
const MU_EARTH = 398_600.4418

/** Earth mean radius, km (WGS-84). */
const EARTH_RADIUS_KM = 6371.0088

/** Nominal geostationary altitude, km. */
const GEO_ALTITUDE_KM = 35_786

/** Half-width of the band treated as geostationary. */
const GEO_TOLERANCE_KM = 500

/**
 * Semi-major axis from Kozai mean motion.
 *
 * a = (mu / n^2)^(1/3), with n in rad/s. satellite.js exposes `satrec.no` in
 * rad/min, hence the division by 60.
 */
export function semiMajorAxisKm(meanMotionRadPerMin: number): number {
  if (!Number.isFinite(meanMotionRadPerMin) || meanMotionRadPerMin <= 0) return Number.NaN
  const radPerSecond = meanMotionRadPerMin / 60
  return Math.cbrt(MU_EARTH / radPerSecond ** 2)
}

export function meanAltitudeKm(meanMotionRadPerMin: number): number {
  return semiMajorAxisKm(meanMotionRadPerMin) - EARTH_RADIUS_KM
}

/**
 * Classifies orbital regime from mean altitude and eccentricity.
 *
 * Eccentricity matters: a Molniya orbit has a mean altitude in the MEO/GEO
 * range but is highly elliptical, and calling it GEO — as the legacy code did —
 * is wrong.
 */
export function classifyOrbit(altitudeKm: number, eccentricity: number): OrbitType {
  if (!Number.isFinite(altitudeKm)) return 'LEO'
  if (eccentricity > 0.25) return 'HEO'
  if (altitudeKm < 2000) return 'LEO'
  if (Math.abs(altitudeKm - GEO_ALTITUDE_KM) <= GEO_TOLERANCE_KM) return 'GEO'
  if (altitudeKm < GEO_ALTITUDE_KM) return 'MEO'
  return 'HEO'
}

/**
 * Initialises SGP4 for a TLE record. Returns null when the elements are
 * rejected by the propagator, so callers can drop the satellite rather than
 * carry a satrec that throws on every frame.
 */
export function initSatellite(record: TleRecord, group: SatelliteGroup): TrackedSatellite | null {
  try {
    const satrec = satellite.twoline2satrec(record.line1, record.line2)
    // satellite.js sets a non-zero `error` code for elements it cannot use.
    if (satrec.error !== 0) return null

    const altitudeKm = meanAltitudeKm(satrec.no)
    if (!Number.isFinite(altitudeKm) || altitudeKm < -EARTH_RADIUS_KM) return null

    const inclinationDeg = (satrec.inclo * 180) / Math.PI

    return {
      id: `${group}-${record.noradId}`,
      name: record.name,
      noradId: record.noradId,
      group,
      orbitType: classifyOrbit(altitudeKm, satrec.ecco),
      inclinationDeg,
      meanAltitudeKm: altitudeKm,
      satrec,
    }
  } catch {
    return null
  }
}

/**
 * Propagates to `date` and converts ECI to geodetic coordinates.
 * Returns null for decayed or numerically diverged satellites.
 */
export function propagateToGeodetic(satrec: satellite.SatRec, date: Date): GeodeticPosition | null {
  try {
    const state = satellite.propagate(satrec, date)
    const position = state?.position
    if (!position || typeof position === 'boolean') return null

    const gmst = satellite.gstime(date)
    const geodetic = satellite.eciToGeodetic(position, gmst)

    const latitudeDeg = satellite.degreesLat(geodetic.latitude)
    const longitudeDeg = satellite.degreesLong(geodetic.longitude)
    if (!Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg)) return null

    const velocity = state.velocity
    const velocityKmS =
      velocity && typeof velocity !== 'boolean'
        ? Math.hypot(velocity.x, velocity.y, velocity.z)
        : Number.NaN

    return {
      latitudeDeg,
      longitudeDeg,
      altitudeKm: geodetic.height,
      velocityKmS,
    }
  } catch {
    return null
  }
}

/**
 * Expected SGP4 along-track error for a TLE of a given age.
 *
 * SGP4 is accurate to roughly 1 km at epoch and degrades by a few km per day.
 * The UI uses this to state accuracy honestly rather than claiming a fixed
 * figure regardless of how stale the elements are.
 */
export function estimatedAccuracyKm(epochAgeHours: number): number {
  const days = Math.max(0, epochAgeHours) / 24
  return 1 + days * 2.5
}
