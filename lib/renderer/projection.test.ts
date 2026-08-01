import { describe, expect, it } from 'vitest'
import { interpolatePosition, project, shortestLonDelta, type Viewport } from './projection'

const viewport: Viewport = {
  centerX: 500,
  centerY: 400,
  radius: 200,
  cameraLon: 0,
  cameraLat: 0,
}

describe('project', () => {
  it('places the sub-viewer point at the centre of the globe', () => {
    const point = project(0, 0, viewport)
    expect(point.x).toBeCloseTo(500, 6)
    expect(point.y).toBeCloseTo(400, 6)
    expect(point.z).toBeCloseTo(1, 6)
    expect(point.visible).toBe(true)
  })

  it('places the north pole directly above the centre', () => {
    const point = project(90, 0, viewport)
    expect(point.x).toBeCloseTo(500, 6)
    expect(point.y).toBeCloseTo(200, 6)
  })

  it('places 90 degrees east on the right limb', () => {
    const point = project(0, 90, viewport)
    expect(point.x).toBeCloseTo(700, 6)
    expect(point.y).toBeCloseTo(400, 6)
    expect(point.z).toBeCloseTo(0, 6)
  })

  it('marks the far side of the globe as not visible', () => {
    const point = project(0, 180, viewport)
    expect(point.z).toBeCloseTo(-1, 6)
    expect(point.visible).toBe(false)
  })

  it('keeps every projected point inside the globe radius', () => {
    for (let lat = -90; lat <= 90; lat += 15) {
      for (let lon = -180; lon <= 180; lon += 15) {
        const point = project(lat, lon, viewport)
        const distance = Math.hypot(point.x - viewport.centerX, point.y - viewport.centerY)
        expect(distance).toBeLessThanOrEqual(viewport.radius + 1e-6)
      }
    }
  })

  it('follows the camera longitude', () => {
    const rotated = { ...viewport, cameraLon: 45 }
    const point = project(0, 45, rotated)
    expect(point.x).toBeCloseTo(500, 6)
    expect(point.z).toBeCloseTo(1, 6)
  })
})

describe('shortestLonDelta', () => {
  it('returns a direct difference away from the antimeridian', () => {
    expect(shortestLonDelta(10, 40)).toBe(30)
    expect(shortestLonDelta(40, 10)).toBe(-30)
  })

  it('crosses the antimeridian the short way', () => {
    expect(shortestLonDelta(179, -179)).toBe(2)
    expect(shortestLonDelta(-179, 179)).toBe(-2)
  })

  it('is bounded to (-180, 180]', () => {
    for (let from = -180; from <= 180; from += 7) {
      for (let to = -180; to <= 180; to += 11) {
        const delta = shortestLonDelta(from, to)
        expect(delta).toBeGreaterThan(-180.000001)
        expect(delta).toBeLessThanOrEqual(180)
      }
    }
  })
})

describe('interpolatePosition', () => {
  const a = { latitudeDeg: 10, longitudeDeg: 20, altitudeKm: 400 }
  const b = { latitudeDeg: 20, longitudeDeg: 40, altitudeKm: 420 }

  it('returns the endpoints at t=0 and t=1', () => {
    expect(interpolatePosition(a, b, 0)).toEqual(a)
    expect(interpolatePosition(a, b, 1)).toEqual(b)
  })

  it('interpolates the midpoint', () => {
    const mid = interpolatePosition(a, b, 0.5)
    expect(mid.latitudeDeg).toBeCloseTo(15, 6)
    expect(mid.longitudeDeg).toBeCloseTo(30, 6)
    expect(mid.altitudeKm).toBeCloseTo(410, 6)
  })

  // Naive interpolation would sweep a satellite 358 degrees westward here.
  it('takes the short path across the antimeridian', () => {
    const from = { latitudeDeg: 0, longitudeDeg: 179, altitudeKm: 500 }
    const to = { latitudeDeg: 0, longitudeDeg: -179, altitudeKm: 500 }
    const mid = interpolatePosition(from, to, 0.5)
    expect(mid.longitudeDeg).toBeCloseTo(180, 6)
  })

  it('clamps t outside [0, 1]', () => {
    expect(interpolatePosition(a, b, -5)).toEqual(a)
    expect(interpolatePosition(a, b, 5)).toEqual(b)
  })
})
