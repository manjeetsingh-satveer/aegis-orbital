import { describe, expect, it } from 'vitest'
import {
  boxesOverlap,
  formatLabel,
  labelBox,
  selectLabels,
  type LabelCandidate,
} from './labels'

const CENTER = { x: 500, y: 400 }

/** Monospace approximation: 9px JetBrains Mono is ~5.4px per character. */
const measure = (text: string, bold: boolean): number => text.length * (bold ? 5.8 : 5.4)

function candidate(overrides: Partial<LabelCandidate> = {}): LabelCandidate {
  return {
    id: 'sat-1',
    name: 'ISS (ZARYA)',
    point: { x: 520, y: 380, z: 0.9 },
    index: 0,
    color: '#3a9fff',
    isThreatened: false,
    isSelected: false,
    priority: 2,
    ...overrides,
  }
}

describe('formatLabel', () => {
  it('strips the CelesTrak designator suffix', () => {
    // This is the case that previously rendered as "GPS BIIR-5 (…".
    expect(formatLabel('GPS BIIR-5  (PRN 22)')).toBe('GPS BIIR-5')
    expect(formatLabel('GPS BIIRM-1 (PRN 17)')).toBe('GPS BIIRM-1')
  })

  it('applies the well-known station shortenings', () => {
    expect(formatLabel('ISS (ZARYA)')).toBe('ISS')
    expect(formatLabel('CSS (TIANHE)')).toBe('CSS')
    expect(formatLabel('STARLINK-1007')).toBe('SL-1007')
  })

  it('truncates anything still too long', () => {
    const result = formatLabel('A VERY LONG SATELLITE NAME INDEED')
    expect(result).toHaveLength(14)
    expect(result.endsWith('…')).toBe(true)
  })

  it('leaves short names untouched', () => {
    expect(formatLabel('NOAA 19')).toBe('NOAA 19')
  })

  it('does not produce an empty label when the name is only a designator', () => {
    expect(formatLabel('(PRN 22)')).toBe('(PRN 22)')
  })

  it('leaves unbalanced parentheses alone rather than mangling them', () => {
    expect(formatLabel('WEIRD (NAME')).toBe('WEIRD (NAME')
  })

  it('handles nested-looking suffixes without over-stripping', () => {
    expect(formatLabel('SAT (A) (B)')).toBe('SAT (A)')
  })
})

describe('boxesOverlap', () => {
  const base = { x: 0, y: 0, width: 10, height: 10 }

  it('detects overlap', () => {
    expect(boxesOverlap(base, { x: 5, y: 5, width: 10, height: 10 })).toBe(true)
  })

  it('treats edge-touching boxes as clear', () => {
    expect(boxesOverlap(base, { x: 10, y: 0, width: 10, height: 10 })).toBe(false)
    expect(boxesOverlap(base, { x: 0, y: 10, width: 10, height: 10 })).toBe(false)
  })

  it('detects separation on either axis', () => {
    expect(boxesOverlap(base, { x: 40, y: 0, width: 10, height: 10 })).toBe(false)
    expect(boxesOverlap(base, { x: 0, y: 40, width: 10, height: 10 })).toBe(false)
  })
})

describe('labelBox', () => {
  it('pushes the box away from the globe centre', () => {
    const right = labelBox(candidate({ point: { x: 600, y: 400, z: 0.5 } }), 50, CENTER)
    expect(right.x).toBeGreaterThan(600)
  })

  it('sizes the box to the measured text', () => {
    const narrow = labelBox(candidate(), 20, CENTER)
    const wide = labelBox(candidate(), 80, CENTER)
    expect(wide.width).toBeGreaterThan(narrow.width)
  })

  it('does not divide by zero at the exact centre', () => {
    const box = labelBox(candidate({ point: { x: CENTER.x, y: CENTER.y, z: 1 } }), 30, CENTER)
    expect(Number.isFinite(box.x)).toBe(true)
    expect(Number.isFinite(box.y)).toBe(true)
  })
})

describe('selectLabels', () => {
  it('returns nothing for an empty candidate set', () => {
    expect(selectLabels([], measure, CENTER)).toEqual([])
    expect(selectLabels([candidate()], measure, CENTER, 0)).toEqual([])
  })

  it('respects the limit', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      candidate({ id: `sat-${i}`, name: `SAT ${i}`, point: { x: 100 + i * 40, y: 200, z: 0.8 } }),
    )
    expect(selectLabels(many, measure, CENTER, 5)).toHaveLength(5)
  })

  // The clutter fix: co-located satellites must not stack labels on each other.
  it('rejects labels that would overlap', () => {
    const stacked = Array.from({ length: 10 }, (_, i) =>
      candidate({ id: `sat-${i}`, name: `SAT ${i}`, point: { x: 600, y: 400 + i * 0.5, z: 0.8 } }),
    )
    const placed = selectLabels(stacked, measure, CENTER)
    expect(placed.length).toBeLessThan(stacked.length)

    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(boxesOverlap(placed[i]!.box, placed[j]!.box)).toBe(false)
      }
    }
  })

  it('always places threatened labels, even when they collide', () => {
    const crowd = Array.from({ length: 6 }, (_, i) =>
      candidate({ id: `sat-${i}`, name: `SAT ${i}`, point: { x: 600, y: 400, z: 0.8 } }),
    )
    const threatened = candidate({
      id: 'under-attack',
      name: 'STARLINK-1007',
      point: { x: 600, y: 400, z: 0.8 },
      isThreatened: true,
      priority: 0,
    })

    const placed = selectLabels([...crowd, threatened], measure, CENTER)
    expect(placed.some((label) => label.id === 'under-attack')).toBe(true)
  })

  it('places the selected satellite even in a crowd', () => {
    const crowd = Array.from({ length: 6 }, (_, i) =>
      candidate({ id: `sat-${i}`, name: `SAT ${i}`, point: { x: 300, y: 300, z: 0.8 } }),
    )
    const selected = candidate({
      id: 'chosen',
      point: { x: 300, y: 300, z: 0.8 },
      isSelected: true,
      priority: 1,
    })

    const placed = selectLabels([...crowd, selected], measure, CENTER)
    expect(placed.some((label) => label.id === 'chosen')).toBe(true)
  })

  it('orders by priority, breaking ties with depth', () => {
    const far = candidate({ id: 'far', point: { x: 700, y: 200, z: 0.3 }, priority: 3 })
    const near = candidate({ id: 'near', point: { x: 200, y: 600, z: 0.95 }, priority: 3 })
    const station = candidate({ id: 'station', point: { x: 300, y: 200, z: 0.2 }, priority: 2 })

    const placed = selectLabels([far, near, station], measure, CENTER)
    expect(placed[0]?.id).toBe('station')
    expect(placed[1]?.id).toBe('near')
  })

  it('does not mutate the input array', () => {
    const input = [
      candidate({ id: 'a', priority: 3 }),
      candidate({ id: 'b', priority: 1 }),
    ]
    const order = input.map((c) => c.id)
    selectLabels(input, measure, CENTER)
    expect(input.map((c) => c.id)).toEqual(order)
  })

  it('formats the text it places', () => {
    const placed = selectLabels([candidate({ name: 'GPS BIIR-5  (PRN 22)' })], measure, CENTER)
    expect(placed[0]?.text).toBe('GPS BIIR-5')
  })
})
