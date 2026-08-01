import type { SatelliteGroup } from './orbital/types'

/**
 * Single source of truth for colour, shared between the canvas renderer and
 * React. Canvas cannot read CSS custom properties, so duplicating these values
 * in a stylesheet would let the globe and the legend drift apart.
 */

export const PALETTE = {
  green: '#00d4a0',
  blue: '#3a9fff',
  amber: '#f5a623',
  orange: '#e06030',
  red: '#ff4444',
  violet: '#b040ff',
  text1: '#ddeeff',
  text2: '#6a90b0',
  text3: '#2e4a68',
  bg0: '#000205',
  bg1: '#020912',
  bg2: '#040f1e',
  bg3: '#071525',
  border1: '#0e2040',
  border2: '#1a3560',
} as const

export const GROUP_COLORS: Readonly<Record<SatelliteGroup, string>> = {
  starlink: PALETTE.green,
  stations: PALETTE.blue,
  gps: PALETTE.amber,
  weather: PALETTE.orange,
}

export const GROUP_LABELS: Readonly<Record<SatelliteGroup, string>> = {
  starlink: 'Starlink LEO',
  stations: 'ISS · Stations',
  gps: 'GPS MEO',
  weather: 'Weather',
}

export const SEVERITY_COLORS = {
  nominal: PALETTE.green,
  elevated: PALETTE.amber,
  critical: PALETTE.red,
} as const

export const ATTACK_COLORS = {
  spoof: PALETTE.red,
  jam: PALETTE.amber,
  inject: PALETTE.red,
  replay: PALETTE.amber,
  phish: PALETTE.violet,
} as const
