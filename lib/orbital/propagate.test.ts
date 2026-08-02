import { describe, expect, it } from 'vitest'
import { parseTle } from './tle'
import {
  classifyOrbit,
  estimatedAccuracyKm,
  initSatellite,
  meanAltitudeKm,
  propagateToGeodetic,
  semiMajorAxisKm,
} from './propagate'

const ISS_L1 = '1 25544U 98067A   24160.52083333  .00016717  00000-0  30777-3 0  9001'
const ISS_L2 = '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49815294 25217'
const ISS_TLE = `ISS (ZARYA)\n${ISS_L1}\n${ISS_L2}`

/** Mean motion in rad/min for a given revolutions-per-day figure. */
const revsPerDayToRadPerMin = (revs: number): number => (revs * 2 * Math.PI) / 1440

describe('semiMajorAxisKm', () => {
  it('recovers the geostationary radius from one revolution per sidereal day', () => {
    // A GEO satellite completes 1.0027 revolutions per solar day; a ≈ 42164 km.
    expect(semiMajorAxisKm(revsPerDayToRadPerMin(1.0027))).toBeCloseTo(42164, -1)
  })

  it('recovers a plausible LEO radius for the ISS', () => {
    // ~15.5 revs/day puts the ISS near 6790 km semi-major axis.
    const a = semiMajorAxisKm(revsPerDayToRadPerMin(15.498))
    expect(a).toBeGreaterThan(6700)
    expect(a).toBeLessThan(6900)
  })

  it('returns NaN for non-physical mean motions', () => {
    expect(semiMajorAxisKm(0)).toBeNaN()
    expect(semiMajorAxisKm(-1)).toBeNaN()
    expect(semiMajorAxisKm(Number.NaN)).toBeNaN()
  })
})

describe('meanAltitudeKm', () => {
  it('puts the ISS in the expected altitude band', () => {
    const altitude = meanAltitudeKm(revsPerDayToRadPerMin(15.498))
    expect(altitude).toBeGreaterThan(380)
    expect(altitude).toBeLessThan(460)
  })

  it('puts GPS in MEO', () => {
    // GPS orbits twice per sidereal day.
    const altitude = meanAltitudeKm(revsPerDayToRadPerMin(2.0056))
    expect(altitude).toBeGreaterThan(19_000)
    expect(altitude).toBeLessThan(21_000)
  })
})

describe('classifyOrbit', () => {
  it('classifies the standard regimes', () => {
    expect(classifyOrbit(420, 0.0007)).toBe('LEO')
    expect(classifyOrbit(20_200, 0.001)).toBe('MEO')
    expect(classifyOrbit(35_786, 0.0002)).toBe('GEO')
  })

  it('treats a near-geostationary altitude as GEO', () => {
    expect(classifyOrbit(35_600, 0.0002)).toBe('GEO')
    expect(classifyOrbit(36_000, 0.0002)).toBe('GEO')
  })

  /*
   * The legacy classifier looked only at altitude, so a Molniya orbit — mean
   * altitude in the MEO/GEO range but highly elliptical — was mislabelled GEO.
   */
  it('classifies a highly elliptical orbit as HEO regardless of altitude', () => {
    expect(classifyOrbit(20_000, 0.74)).toBe('HEO')
    expect(classifyOrbit(35_786, 0.6)).toBe('HEO')
  })

  it('classifies super-synchronous orbits as HEO', () => {
    expect(classifyOrbit(60_000, 0.01)).toBe('HEO')
  })

  it('falls back to LEO for a non-finite altitude', () => {
    expect(classifyOrbit(Number.NaN, 0)).toBe('LEO')
  })
})

describe('initSatellite', () => {
  const [record] = parseTle(ISS_TLE).records

  it('initialises a tracked satellite from valid elements', () => {
    const satellite = initSatellite(record!, 'stations')
    expect(satellite).not.toBeNull()
    expect(satellite?.noradId).toBe(25544)
    expect(satellite?.group).toBe('stations')
    expect(satellite?.orbitType).toBe('LEO')
    expect(satellite?.id).toBe('stations-25544')
  })

  it('reports inclination in degrees', () => {
    const satellite = initSatellite(record!, 'stations')
    expect(satellite?.inclinationDeg).toBeCloseTo(51.6416, 2)
  })

  it('returns null rather than a satrec that throws on every frame', () => {
    const broken = {
      name: 'BROKEN',
      noradId: 99_999,
      line1: '1 99999U 00000A   24160.00000000  .00000000  00000-0  00000-0 0  0000',
      line2: '2 99999 000.0000 000.0000 0000000 000.0000 000.0000 00.00000000000000',
    }
    expect(initSatellite(broken, 'starlink')).toBeNull()
  })
})

describe('propagateToGeodetic', () => {
  const satellite = initSatellite(parseTle(ISS_TLE).records[0]!, 'stations')!

  it('produces coordinates within geodetic bounds', () => {
    const position = propagateToGeodetic(satellite.satrec, new Date('2024-06-08T12:30:00Z'))
    expect(position).not.toBeNull()
    expect(Math.abs(position!.latitudeDeg)).toBeLessThanOrEqual(90)
    expect(Math.abs(position!.longitudeDeg)).toBeLessThanOrEqual(180)
  })

  it('keeps the ISS at a plausible altitude and orbital speed at epoch', () => {
    const position = propagateToGeodetic(satellite.satrec, new Date('2024-06-08T12:30:00Z'))!
    expect(position.altitudeKm).toBeGreaterThan(380)
    expect(position.altitudeKm).toBeLessThan(460)
    // LEO orbital velocity is ~7.66 km/s.
    expect(position.velocityKmS).toBeGreaterThan(7.5)
    expect(position.velocityKmS).toBeLessThan(7.9)
  })

  it('never exceeds its inclination in latitude', () => {
    // Sampled across a full day; a 51.6 degree orbit cannot reach the poles.
    for (let minutes = 0; minutes < 1440; minutes += 37) {
      const date = new Date(Date.UTC(2024, 5, 8, 0, minutes))
      const position = propagateToGeodetic(satellite.satrec, date)
      if (position === null) continue
      expect(Math.abs(position.latitudeDeg)).toBeLessThanOrEqual(52.5)
    }
  })

  it('moves the satellite between successive samples', () => {
    const first = propagateToGeodetic(satellite.satrec, new Date('2024-06-08T12:30:00Z'))!
    const second = propagateToGeodetic(satellite.satrec, new Date('2024-06-08T12:35:00Z'))!
    expect(first.longitudeDeg).not.toBeCloseTo(second.longitudeDeg, 3)
  })
})

describe('estimatedAccuracyKm', () => {
  // SGP4 is roughly 1 km at epoch and degrades a few km per day. The legacy
  // build claimed "accurate to meters" in one place and "~1 km" in another.
  it('is about a kilometre at epoch', () => {
    expect(estimatedAccuracyKm(0)).toBeCloseTo(1, 5)
  })

  it('degrades with element age', () => {
    expect(estimatedAccuracyKm(24)).toBeGreaterThan(estimatedAccuracyKm(0))
    expect(estimatedAccuracyKm(24 * 7)).toBeGreaterThan(estimatedAccuracyKm(24))
  })

  it('does not improve on a negative age', () => {
    expect(estimatedAccuracyKm(-100)).toBe(1)
  })
})
