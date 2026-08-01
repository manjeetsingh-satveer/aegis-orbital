/**
 * Orthographic globe projection.
 *
 * Maps geodetic coordinates onto a sphere viewed from infinity. `z` is the
 * dot product of the surface normal with the view direction: positive means the
 * point faces the viewer, and it doubles as a depth cue for fading.
 */

export interface Viewport {
  /** Centre of the globe in canvas pixels. */
  readonly centerX: number
  readonly centerY: number
  /** Globe radius in canvas pixels. */
  readonly radius: number
  /** Camera longitude (degrees) — the meridian facing the viewer. */
  readonly cameraLon: number
  /** Camera latitude (degrees). */
  readonly cameraLat: number
}

export interface ProjectedPoint {
  readonly x: number
  readonly y: number
  /** Cosine of the angle from the sub-viewer point. Positive is front-facing. */
  readonly z: number
  readonly visible: boolean
}

const DEG_TO_RAD = Math.PI / 180

/**
 * Points marginally behind the limb are kept so that polygons crossing the
 * horizon do not tear.
 */
const HORIZON_EPSILON = -0.05

export function project(latDeg: number, lonDeg: number, viewport: Viewport): ProjectedPoint {
  const { centerX, centerY, radius, cameraLon, cameraLat } = viewport

  const deltaLon = (lonDeg - cameraLon) * DEG_TO_RAD
  const lat = latDeg * DEG_TO_RAD
  const camLat = cameraLat * DEG_TO_RAD

  const cosLat = Math.cos(lat)
  const sinLat = Math.sin(lat)
  const cosCamLat = Math.cos(camLat)
  const sinCamLat = Math.sin(camLat)
  const cosDeltaLon = Math.cos(deltaLon)

  const x = radius * cosLat * Math.sin(deltaLon)
  const y = radius * (cosCamLat * sinLat - sinCamLat * cosLat * cosDeltaLon)
  const z = sinCamLat * sinLat + cosCamLat * cosLat * cosDeltaLon

  return {
    x: centerX + x,
    y: centerY - y,
    z,
    visible: z > HORIZON_EPSILON,
  }
}

/**
 * Shortest angular difference between two longitudes, in degrees, wrapped to
 * (-180, 180]. Used when interpolating positions across the antimeridian, where
 * naive interpolation sends a satellite the long way around the globe.
 */
export function shortestLonDelta(fromDeg: number, toDeg: number): number {
  let delta = (toDeg - fromDeg) % 360
  if (delta > 180) delta -= 360
  if (delta <= -180) delta += 360
  return delta
}

/** Linear interpolation between two sub-satellite points, antimeridian-safe. */
export function interpolatePosition(
  from: { latitudeDeg: number; longitudeDeg: number; altitudeKm: number },
  to: { latitudeDeg: number; longitudeDeg: number; altitudeKm: number },
  t: number,
): { latitudeDeg: number; longitudeDeg: number; altitudeKm: number } {
  const clamped = Math.min(1, Math.max(0, t))
  return {
    latitudeDeg: from.latitudeDeg + (to.latitudeDeg - from.latitudeDeg) * clamped,
    longitudeDeg: from.longitudeDeg + shortestLonDelta(from.longitudeDeg, to.longitudeDeg) * clamped,
    altitudeKm: from.altitudeKm + (to.altitudeKm - from.altitudeKm) * clamped,
  }
}
