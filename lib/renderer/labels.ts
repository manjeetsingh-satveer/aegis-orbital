/**
 * Label formatting and placement.
 *
 * Kept separate from GlobeRenderer so it can be tested without a canvas: this
 * is the logic that decides what the user actually reads, and it was the source
 * of the overlapping-label clutter in the legacy build.
 */

export const LABEL_HEIGHT = 11
export const LABEL_PADDING = 3

/** Cap on labels in smart mode; collision rejection alone still leaves a busy view. */
export const MAX_SMART_LABELS = 16

/** Radial offset from the satellite dot to its label. */
const LABEL_OFFSET = 14

export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface LabelCandidate {
  readonly id: string
  readonly name: string
  readonly point: { readonly x: number; readonly y: number; readonly z: number }
  readonly index: number
  readonly color: string
  readonly isThreatened: boolean
  readonly isSelected: boolean
  /** Lower sorts first. Threats win, then selection, then stations, then the rest. */
  readonly priority: number
}

export interface PlacedLabel extends LabelCandidate {
  readonly text: string
  readonly box: Box
}

/**
 * Shortens a satellite name to fit a label pill.
 *
 * CelesTrak suffixes many names with a designator — "GPS BIIR-5  (PRN 22)" —
 * which is noise at globe scale and was previously rendered as a dangling
 * "GPS BIIR-5 (…".
 */
export function formatLabel(name: string): string {
  const withoutDesignator = name
    .replace('STARLINK-', 'SL-')
    .replace(' (ZARYA)', '')
    .replace(' (TIANHE)', '')
    .replace(/\s*\([^()]*\)\s*$/, '')
    .trim()

  const cleaned = withoutDesignator.length > 0 ? withoutDesignator : name.trim()
  return cleaned.length > 14 ? `${cleaned.slice(0, 13)}…` : cleaned
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/** Places a label box radially outward from the globe centre. */
export function labelBox(
  candidate: LabelCandidate,
  textWidth: number,
  center: { readonly x: number; readonly y: number },
): Box {
  const dx = candidate.point.x - center.x
  const dy = candidate.point.y - center.y
  const distance = Math.hypot(dx, dy) || 1

  const x = candidate.point.x + (dx / distance) * LABEL_OFFSET
  // Alternating vertical nudge breaks up ties between neighbouring satellites.
  const y =
    candidate.point.y + (dy / distance) * LABEL_OFFSET + (candidate.index % 2 === 0 ? -8 : 8)

  return {
    x: x - LABEL_PADDING,
    y: y - LABEL_HEIGHT,
    width: textWidth + LABEL_PADDING * 2 + 1,
    height: LABEL_HEIGHT + 2,
  }
}

/**
 * Greedy label placement with collision rejection.
 *
 * Candidates are sorted by priority — nearer satellites winning ties — and a
 * label is dropped when its box would overlap one already placed. Threatened
 * and selected assets are drawn regardless, because losing the label on the
 * satellite under attack would defeat the point of the display.
 */
export function selectLabels(
  candidates: readonly LabelCandidate[],
  measureText: (text: string, bold: boolean) => number,
  center: { readonly x: number; readonly y: number },
  limit: number = MAX_SMART_LABELS,
): PlacedLabel[] {
  if (candidates.length === 0 || limit <= 0) return []

  const ordered = [...candidates].sort(
    (a, b) => a.priority - b.priority || b.point.z - a.point.z,
  )

  const placed: PlacedLabel[] = []

  for (const candidate of ordered) {
    if (placed.length >= limit) break

    const alwaysShow = candidate.isThreatened || candidate.isSelected
    const text = formatLabel(candidate.name)
    const box = labelBox(candidate, measureText(text, alwaysShow), center)

    if (!alwaysShow && placed.some((other) => boxesOverlap(box, other.box))) continue

    placed.push({ ...candidate, text, box })
  }

  return placed
}
