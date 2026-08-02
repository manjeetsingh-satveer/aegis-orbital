import { NextResponse } from 'next/server'
import { feature } from 'topojson-client'
import type { FeatureCollection, Geometry, Polygon, MultiPolygon } from 'geojson'
import type { Topology } from 'topojson-specification'
import worldAtlas from 'world-atlas/countries-110m.json'

/**
 * Coastline geometry for the globe.
 *
 * Previously fetched from cdn.jsdelivr.net and decoded with a hand-rolled
 * TopoJSON reader in the browser. Bundling world-atlas and decoding here means
 * one fewer third-party origin (so `default-src 'self'` holds), a correct
 * decoder instead of an approximation, and the decode cost paid once on the
 * server rather than in every visitor's tab.
 */

/** Country outlines never change; cache indefinitely. */
export const revalidate = false

/** Rings smaller than this are dropped — invisible at globe scale. */
const MIN_RING_POINTS = 4

type Ring = [number, number][]

function extractRings(geometry: Geometry): Ring[] {
  const rings: Ring[] = []

  const push = (polygon: Polygon['coordinates']): void => {
    // Outer ring only; interior holes are not visible at this scale.
    const outer = polygon[0]
    if (outer && outer.length >= MIN_RING_POINTS) {
      rings.push(outer.map(([lon, lat]) => [lon ?? 0, lat ?? 0]))
    }
  }

  if (geometry.type === 'Polygon') {
    push(geometry.coordinates)
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of (geometry as MultiPolygon).coordinates) push(polygon)
  }

  return rings
}

let cachedRings: Ring[] | null = null

function landRings(): Ring[] {
  if (cachedRings !== null) return cachedRings

  const topology = worldAtlas as unknown as Topology
  const countries = feature(
    topology,
    topology.objects.countries as Parameters<typeof feature>[1],
  ) as FeatureCollection

  const rings: Ring[] = []
  for (const item of countries.features) {
    if (item.geometry) rings.push(...extractRings(item.geometry))
  }

  cachedRings = rings
  return rings
}

/*
 * Deliberately static and un-rate-limited: this serves bundled, immutable
 * geometry and makes no upstream call, so there is nothing to amplify against.
 * Serving it from the static cache is both cheaper and safer than running a
 * handler per request.
 */
export function GET(): NextResponse {
  const rings = landRings()

  return NextResponse.json(
    {
      // Flat arrays of [lon, lat] pairs, ready for the projection to consume.
      rings,
      count: rings.length,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=86400, s-maxage=31536000, immutable',
      },
    },
  )
}
