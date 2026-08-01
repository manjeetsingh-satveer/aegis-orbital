import { propagateToGeodetic } from '@/lib/orbital/propagate'
import type { GeodeticPosition, TrackedSatellite } from '@/lib/orbital/types'
import { GROUP_COLORS, PALETTE } from '@/lib/theme'
import { interpolatePosition, project, type Viewport } from './projection'

export type LabelMode = 'smart' | 'all' | 'none'

export type LandRing = readonly (readonly [number, number])[]

export interface GlobeRendererOptions {
  readonly onSelect?: (satelliteId: string | null) => void
  readonly onFrame?: (stats: FrameStats) => void
}

export interface FrameStats {
  readonly visibleSatellites: number
  readonly fps: number
}

/**
 * SGP4 is run at this rate rather than once per frame. At 60fps with 170
 * satellites the legacy renderer performed ~10,200 propagations per second;
 * this performs 1,700 and interpolates between them, which is visually
 * identical because a LEO satellite moves under 0.1 degrees in 100ms.
 */
const PROPAGATION_INTERVAL_MS = 100

/** Static stars in the cached backdrop. */
const STAR_COUNT = 420

/** Bright stars redrawn each frame so the sky still twinkles. */
const TWINKLING_STAR_COUNT = 24

const AUTO_ROTATE_DEG_PER_SEC = 1.4

/** Auto-rotation pauses this long after the user interacts. */
const AUTO_ROTATE_RESUME_MS = 4000

/** Label geometry, shared between placement and drawing. */
const LABEL_HEIGHT = 11
const LABEL_PADDING = 3

/**
 * Cap on labels in smart mode. Collision rejection alone still leaves a busy
 * view when a hundred satellites face the camera.
 */
const MAX_SMART_LABELS = 16

interface LabelCandidate {
  readonly name: string
  readonly point: { x: number; y: number; z: number }
  readonly index: number
  readonly color: string
  readonly isThreatened: boolean
  readonly isSelected: boolean
  readonly priority: number
}

/** Shortens a satellite name to fit a label pill. */
function formatLabel(name: string): string {
  const shortened = name
    .replace('STARLINK-', 'SL-')
    .replace(' (ZARYA)', '')
    .replace(' (TIANHE)', '')
    .replace(/\s*\(.*\)$/, '')
  return shortened.length > 14 ? `${shortened.slice(0, 13)}…` : shortened
}

const CITY_LIGHTS: readonly (readonly [number, number])[] = [
  [40.7, -74], [51.5, -0.1], [48.8, 2.3], [35.7, 139.7], [31.2, 121.5],
  [19.1, 72.9], [55.8, 37.6], [34.0, -118], [23.1, 113.3], [28.6, 77.2],
  [-33.9, 151.2], [1.3, 103.8], [30.0, 31.2], [-23.5, -46.6], [19.4, -99.1],
]

interface PositionSample {
  readonly from: GeodeticPosition
  readonly to: GeodeticPosition
}

/**
 * Imperative canvas renderer for the orbital globe.
 *
 * Deliberately framework-agnostic: it owns its own animation frame loop and
 * never notifies React per frame. Driving 170 satellite positions through React
 * state at 60fps would dispatch ~10,000 updates per second and stall the app.
 * React mounts this once, pushes data in through setters, and receives only
 * discrete events (selection) back out.
 */
export class GlobeRenderer {
  readonly #canvas: HTMLCanvasElement
  readonly #ctx: CanvasRenderingContext2D
  readonly #options: GlobeRendererOptions

  #satellites: readonly TrackedSatellite[] = []
  #landRings: readonly LandRing[] = []
  #threatIds: ReadonlySet<string> = new Set()
  #selectedId: string | null = null
  #labelMode: LabelMode = 'smart'

  // Viewport state, in CSS pixels.
  #width = 0
  #height = 0
  #radius = 0
  #cameraLon = 0
  #cameraLat = 20

  // Position cache, parallel to #satellites.
  #samples: (PositionSample | null)[] = []
  #lastPropagationAt = 0

  /** Screen positions from the last frame, reused for hit-testing. */
  #screenPositions: ({ x: number; y: number; z: number } | null)[] = []

  // Cached static backdrop (space gradient, stars, milky way, sun).
  #backdrop: HTMLCanvasElement | null = null
  #twinklingStars: { x: number; y: number; radius: number; phase: number }[] = []

  // Interaction state.
  #dragging = false
  #dragPointerId: number | null = null
  #dragStartX = 0
  #dragStartY = 0
  #dragStartLon = 0
  #dragStartLat = 0
  #dragDistance = 0
  #activePointers = new Map<number, { x: number; y: number }>()
  #pinchStartDistance = 0
  #pinchStartRadius = 0
  #autoRotateResumeAt = 0

  #rafId: number | null = null
  #lastFrameAt = 0
  #fps = 0
  #resizeObserver: ResizeObserver | null = null
  #destroyed = false

  constructor(canvas: HTMLCanvasElement, options: GlobeRendererOptions = {}) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (ctx === null) throw new Error('2D canvas context unavailable')

    this.#canvas = canvas
    this.#ctx = ctx
    this.#options = options

    this.#attachListeners()
    this.#resize()

    this.#resizeObserver = new ResizeObserver(() => this.#resize())
    this.#resizeObserver.observe(canvas.parentElement ?? canvas)
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setSatellites(satellites: readonly TrackedSatellite[]): void {
    this.#satellites = satellites
    this.#samples = new Array(satellites.length).fill(null)
    this.#screenPositions = new Array(satellites.length).fill(null)
    this.#lastPropagationAt = 0
  }

  setLandRings(rings: readonly LandRing[]): void {
    this.#landRings = rings
  }

  setThreatIds(ids: ReadonlySet<string>): void {
    this.#threatIds = ids
  }

  setSelectedId(id: string | null): void {
    this.#selectedId = id
  }

  setLabelMode(mode: LabelMode): void {
    this.#labelMode = mode
  }

  start(): void {
    if (this.#rafId !== null || this.#destroyed) return
    this.#lastFrameAt = performance.now()
    const loop = (timestamp: number): void => {
      if (this.#destroyed) return
      this.#rafId = requestAnimationFrame(loop)
      this.#tick(timestamp)
    }
    this.#rafId = requestAnimationFrame(loop)
  }

  destroy(): void {
    this.#destroyed = true
    if (this.#rafId !== null) cancelAnimationFrame(this.#rafId)
    this.#rafId = null
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    this.#detachListeners()
  }

  // ── Frame loop ────────────────────────────────────────────────────────────

  #tick(timestamp: number): void {
    const deltaMs = Math.min(100, timestamp - this.#lastFrameAt)
    this.#lastFrameAt = timestamp
    if (deltaMs > 0) this.#fps = this.#fps * 0.9 + (1000 / deltaMs) * 0.1

    if (!this.#dragging && timestamp >= this.#autoRotateResumeAt) {
      this.#cameraLon -= (AUTO_ROTATE_DEG_PER_SEC * deltaMs) / 1000
      if (this.#cameraLon < -180) this.#cameraLon += 360
    }

    const now = Date.now()
    if (now - this.#lastPropagationAt >= PROPAGATION_INTERVAL_MS) {
      this.#propagate(new Date(now))
      this.#lastPropagationAt = now
    }

    const interpolation = Math.min(1, (now - this.#lastPropagationAt) / PROPAGATION_INTERVAL_MS)
    this.#render(interpolation)
  }

  /**
   * Propagates each satellite to the current instant and one interval ahead, so
   * rendering interpolates between two exact SGP4 solutions rather than
   * extrapolating from one.
   */
  #propagate(now: Date): void {
    const next = new Date(now.getTime() + PROPAGATION_INTERVAL_MS)
    for (let i = 0; i < this.#satellites.length; i += 1) {
      const satellite = this.#satellites[i]
      if (satellite === undefined) continue
      const from = propagateToGeodetic(satellite.satrec, now)
      const to = from === null ? null : propagateToGeodetic(satellite.satrec, next)
      this.#samples[i] = from !== null && to !== null ? { from, to } : null
    }
  }

  get #viewport(): Viewport {
    return {
      centerX: this.#width / 2,
      centerY: this.#height / 2,
      radius: this.#radius,
      cameraLon: this.#cameraLon,
      cameraLat: this.#cameraLat,
    }
  }

  #render(interpolation: number): void {
    const ctx = this.#ctx
    const { centerX, centerY, radius } = this.#viewport

    // Cached backdrop replaces ~430 arc() calls and two gradients per frame.
    if (this.#backdrop !== null) ctx.drawImage(this.#backdrop, 0, 0, this.#width, this.#height)
    this.#drawTwinklingStars()

    this.#drawAtmosphere(centerX, centerY, radius)
    this.#drawOcean(centerX, centerY, radius)

    ctx.save()
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius - 0.5, 0, Math.PI * 2)
    ctx.clip()

    this.#drawGraticule()
    this.#drawLandmasses()
    this.#drawCloudBands()
    this.#drawNightShadow(centerX, centerY, radius)
    this.#drawCityLights(centerX, radius)
    this.#drawEquator()

    ctx.restore()

    this.#drawRim(centerX, centerY, radius)
    const visible = this.#drawSatellites(interpolation)

    this.#options.onFrame?.({ visibleSatellites: visible, fps: this.#fps })
  }

  // ── Backdrop ──────────────────────────────────────────────────────────────

  #buildBackdrop(): void {
    if (this.#width === 0 || this.#height === 0) return

    const dpr = window.devicePixelRatio || 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(this.#width * dpr)
    canvas.height = Math.floor(this.#height * dpr)
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    ctx.scale(dpr, dpr)

    const { width: w, height: h } = { width: this.#width, height: this.#height }

    const space = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.8)
    space.addColorStop(0, '#000614')
    space.addColorStop(1, PALETTE.bg0)
    ctx.fillStyle = space
    ctx.fillRect(0, 0, w, h)

    // Deterministic star field: the same layout every load, so a resize does
    // not shuffle the sky.
    for (let i = 0; i < STAR_COUNT; i += 1) {
      const x = (i * 97 + 13) % w
      const y = (i * 163 + 47) % h
      const isBig = i % 20 === 0
      const isMedium = i % 6 === 0
      const brightness = isBig ? 0.9 : isMedium ? 0.55 : 0.28
      const isOrange = i % 25 === 0
      ctx.fillStyle = isOrange
        ? `rgba(255,180,80,${brightness})`
        : `rgba(${195 + (i % 60)},${210 + (i % 45)},255,${brightness})`
      ctx.beginPath()
      ctx.arc(x, y, isBig ? 1.5 : isMedium ? 1 : 0.5, 0, Math.PI * 2)
      ctx.fill()
    }

    const milkyWay = ctx.createLinearGradient(w * 0.05, h * 0.1, w * 0.95, h * 0.85)
    milkyWay.addColorStop(0, 'transparent')
    milkyWay.addColorStop(0.3, 'rgba(80,90,180,.05)')
    milkyWay.addColorStop(0.5, 'rgba(90,100,200,.08)')
    milkyWay.addColorStop(0.7, 'rgba(80,90,180,.04)')
    milkyWay.addColorStop(1, 'transparent')
    ctx.fillStyle = milkyWay
    ctx.fillRect(0, 0, w, h)

    const sunX = w * 0.07
    const sunY = h * 0.09
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 65)
    glow.addColorStop(0, 'rgba(255,248,180,1)')
    glow.addColorStop(0.12, 'rgba(255,200,50,.8)')
    glow.addColorStop(0.35, 'rgba(255,120,0,.22)')
    glow.addColorStop(1, 'transparent')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(sunX, sunY, 65, 0, Math.PI * 2)
    ctx.fill()

    const core = ctx.createRadialGradient(sunX - 1, sunY - 1, 0, sunX, sunY, 10)
    core.addColorStop(0, '#fffce0')
    core.addColorStop(1, '#ffcc30')
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(sunX, sunY, 10, 0, Math.PI * 2)
    ctx.fill()

    this.#backdrop = canvas

    this.#twinklingStars = Array.from({ length: TWINKLING_STAR_COUNT }, (_, i) => ({
      x: (i * 331 + 71) % w,
      y: (i * 211 + 29) % h,
      radius: 1.2 + (i % 3) * 0.3,
      phase: i * 0.8,
    }))
  }

  #drawTwinklingStars(): void {
    const ctx = this.#ctx
    const time = performance.now() * 0.0007
    for (const star of this.#twinklingStars) {
      const alpha = 0.35 + 0.65 * Math.abs(Math.sin(time + star.phase))
      ctx.fillStyle = `rgba(220,235,255,${alpha})`
      ctx.beginPath()
      ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ── Earth ─────────────────────────────────────────────────────────────────

  #drawAtmosphere(cx: number, cy: number, r: number): void {
    const ctx = this.#ctx
    const glow = ctx.createRadialGradient(cx, cy, r * 0.88, cx, cy, r * 1.16)
    glow.addColorStop(0, 'transparent')
    glow.addColorStop(0.55, 'rgba(20,80,220,.07)')
    glow.addColorStop(0.82, 'rgba(30,110,255,.2)')
    glow.addColorStop(1, 'transparent')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, cy, r * 1.16, 0, Math.PI * 2)
    ctx.fill()
  }

  #drawOcean(cx: number, cy: number, r: number): void {
    const ctx = this.#ctx
    const ocean = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.2, 0, cx, cy, r)
    ocean.addColorStop(0, '#1c5599')
    ocean.addColorStop(0.3, '#103878')
    ocean.addColorStop(0.65, '#082248')
    ocean.addColorStop(1, '#030e25')
    ctx.fillStyle = ocean
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }

  #drawGraticule(): void {
    const ctx = this.#ctx
    const viewport = this.#viewport
    ctx.strokeStyle = 'rgba(15,55,130,.18)'
    ctx.lineWidth = 0.35

    for (let lat = -75; lat <= 75; lat += 15) {
      ctx.beginPath()
      let pendingMove = true
      for (let lon = -180; lon <= 180; lon += 3) {
        const point = project(lat, lon, viewport)
        if (!point.visible) {
          pendingMove = true
          continue
        }
        if (pendingMove) {
          ctx.moveTo(point.x, point.y)
          pendingMove = false
        } else ctx.lineTo(point.x, point.y)
      }
      ctx.stroke()
    }

    for (let lon = -180; lon <= 180; lon += 15) {
      ctx.beginPath()
      let pendingMove = true
      for (let lat = -87; lat <= 87; lat += 3) {
        const point = project(lat, lon, viewport)
        if (!point.visible) {
          pendingMove = true
          continue
        }
        if (pendingMove) {
          ctx.moveTo(point.x, point.y)
          pendingMove = false
        } else ctx.lineTo(point.x, point.y)
      }
      ctx.stroke()
    }
  }

  /**
   * Builds the coastline path once and fills it three times.
   *
   * The legacy renderer re-projected every coastline vertex for each of its
   * three passes. Projection is the expensive part — three fills of one Path2D
   * are visually identical at a third of the cost.
   */
  #drawLandmasses(): void {
    if (this.#landRings.length === 0) return

    const ctx = this.#ctx
    const viewport = this.#viewport
    const { centerX, centerY, radius } = viewport

    const path = new Path2D()
    for (const ring of this.#landRings) {
      let pendingMove = true
      let visibleCount = 0
      for (const coordinate of ring) {
        const point = project(coordinate[1], coordinate[0], viewport)
        if (!point.visible) {
          pendingMove = true
          continue
        }
        visibleCount += 1
        if (pendingMove) {
          path.moveTo(point.x, point.y)
          pendingMove = false
        } else path.lineTo(point.x, point.y)
      }
      if (visibleCount >= 2) path.closePath()
    }

    ctx.fillStyle = 'rgba(22,62,30,.95)'
    ctx.strokeStyle = 'rgba(40,130,60,.4)'
    ctx.lineWidth = 0.4
    ctx.fill(path)
    ctx.stroke(path)

    const arid = ctx.createLinearGradient(
      centerX - radius,
      centerY - radius * 0.1,
      centerX + radius,
      centerY + radius * 0.1,
    )
    arid.addColorStop(0, 'transparent')
    arid.addColorStop(0.35, 'rgba(130,100,40,.22)')
    arid.addColorStop(0.5, 'rgba(150,110,35,.3)')
    arid.addColorStop(0.65, 'rgba(130,100,40,.22)')
    arid.addColorStop(1, 'transparent')
    ctx.fillStyle = arid
    ctx.fill(path)

    const sunlit = ctx.createRadialGradient(
      centerX - radius * 0.3,
      centerY - radius * 0.25,
      0,
      centerX,
      centerY,
      radius,
    )
    sunlit.addColorStop(0, 'rgba(70,130,50,.3)')
    sunlit.addColorStop(0.4, 'rgba(50,100,40,.12)')
    sunlit.addColorStop(1, 'transparent')
    ctx.fillStyle = sunlit
    ctx.fill(path)
  }

  #drawCloudBands(): void {
    const ctx = this.#ctx
    const viewport = this.#viewport
    const drift = performance.now() * 0.00003
    const bands = [
      { lat: 55, width: 8, offset: drift * 1.2 },
      { lat: 38, width: 5, offset: -drift },
      { lat: 12, width: 10, offset: drift * 0.8 },
      { lat: -8, width: 7, offset: -drift * 0.9 },
      { lat: -28, width: 6, offset: drift * 1.1 },
      { lat: -52, width: 9, offset: -drift * 0.7 },
    ]

    for (const band of bands) {
      for (let offset = -band.width * 0.5; offset < band.width * 0.5; offset += 1.6) {
        const lat = band.lat + offset
        const alpha = 0.06 + 0.08 * (1 - Math.abs(offset / (band.width * 0.5)))
        ctx.beginPath()
        let pendingMove = true
        for (let lon = -180; lon <= 180; lon += 3) {
          const point = project(lat, lon + band.offset * 180, viewport)
          if (!point.visible) {
            pendingMove = true
            continue
          }
          if (pendingMove) {
            ctx.moveTo(point.x, point.y)
            pendingMove = false
          } else ctx.lineTo(point.x, point.y)
        }
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`
        ctx.lineWidth = 1.2 + Math.abs(offset / (band.width * 0.5)) * 2
        ctx.stroke()
      }
    }
  }

  #drawNightShadow(cx: number, cy: number, r: number): void {
    const ctx = this.#ctx
    const shadow = ctx.createRadialGradient(
      cx + r * 0.42, cy + r * 0.12, 0,
      cx + r * 0.28, cy + r * 0.08, r * 1.08,
    )
    shadow.addColorStop(0, 'transparent')
    shadow.addColorStop(0.42, 'rgba(0,1,8,0)')
    shadow.addColorStop(0.62, 'rgba(0,1,8,.38)')
    shadow.addColorStop(0.8, 'rgba(0,1,8,.72)')
    shadow.addColorStop(1, 'rgba(0,1,8,.92)')
    ctx.fillStyle = shadow
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }

  #drawCityLights(cx: number, r: number): void {
    const ctx = this.#ctx
    const viewport = this.#viewport
    for (const [lat, lon] of CITY_LIGHTS) {
      const point = project(lat, lon, viewport)
      if (!point.visible) continue
      const nightAmount = Math.max(0, ((point.x - cx) / r) * 0.8 + 0.15)
      if (nightAmount < 0.08) continue

      ctx.globalAlpha = nightAmount * 0.7
      const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, 5)
      glow.addColorStop(0, 'rgba(255,220,80,.9)')
      glow.addColorStop(1, 'transparent')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(point.x, point.y, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffe060'
      ctx.beginPath()
      ctx.arc(point.x, point.y, 1, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }

  #drawEquator(): void {
    const ctx = this.#ctx
    const viewport = this.#viewport
    ctx.strokeStyle = 'rgba(0,220,160,.1)'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    let pendingMove = true
    for (let lon = -180; lon <= 180; lon += 2) {
      const point = project(0, lon, viewport)
      if (!point.visible) {
        pendingMove = true
        continue
      }
      if (pendingMove) {
        ctx.moveTo(point.x, point.y)
        pendingMove = false
      } else ctx.lineTo(point.x, point.y)
    }
    ctx.stroke()
  }

  #drawRim(cx: number, cy: number, r: number): void {
    const ctx = this.#ctx
    const rim = ctx.createLinearGradient(cx - r, cy, cx + r, cy)
    rim.addColorStop(0, 'rgba(60,140,255,.7)')
    rim.addColorStop(0.5, 'rgba(30,80,200,.2)')
    rim.addColorStop(1, 'rgba(60,140,255,.7)')
    ctx.strokeStyle = rim
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()

    const specular = ctx.createRadialGradient(
      cx - r * 0.42, cy - r * 0.38, 0,
      cx - r * 0.22, cy - r * 0.2, r * 0.65,
    )
    specular.addColorStop(0, 'rgba(200,230,255,.12)')
    specular.addColorStop(0.4, 'rgba(150,200,255,.04)')
    specular.addColorStop(1, 'transparent')
    ctx.fillStyle = specular
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // ── Satellites ────────────────────────────────────────────────────────────

  #drawSatellites(interpolation: number): number {
    const ctx = this.#ctx
    const viewport = this.#viewport
    const pulse = (performance.now() % 1500) / 1500
    let visibleCount = 0

    // Label candidates are collected during the dot pass and placed afterwards,
    // so higher-priority labels claim screen space first.
    const labelCandidates: LabelCandidate[] = []

    for (let i = 0; i < this.#satellites.length; i += 1) {
      const satellite = this.#satellites[i]
      const sample = this.#samples[i]
      if (satellite === undefined || sample == null) {
        this.#screenPositions[i] = null
        continue
      }

      const position = interpolatePosition(sample.from, sample.to, interpolation)
      const point = project(position.latitudeDeg, position.longitudeDeg, viewport)

      if (!point.visible || point.z < 0.04) {
        this.#screenPositions[i] = null
        continue
      }

      this.#screenPositions[i] = { x: point.x, y: point.y, z: point.z }
      visibleCount += 1

      const isThreatened = this.#threatIds.has(satellite.id)
      const isSelected = satellite.id === this.#selectedId
      const color = isThreatened ? PALETTE.red : GROUP_COLORS[satellite.group]
      const dotRadius = isThreatened || isSelected ? 5.5 : 3

      if (isThreatened) {
        ctx.beginPath()
        ctx.arc(point.x, point.y, dotRadius + pulse * 12, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(255,68,68,${0.65 - pulse * 0.65})`
        ctx.lineWidth = 1
        ctx.stroke()
      }

      if (isSelected) {
        ctx.beginPath()
        ctx.arc(point.x, point.y, dotRadius + 5, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,255,255,.65)'
        ctx.lineWidth = 1
        ctx.stroke()
      }

      if (isThreatened || isSelected || satellite.group === 'stations') {
        const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, dotRadius * 3.5)
        glow.addColorStop(0, `${color}aa`)
        glow.addColorStop(1, `${color}00`)
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(point.x, point.y, dotRadius * 3.5, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.globalAlpha = 0.5 + point.z * 0.5
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(point.x, point.y, dotRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1

      if (this.#shouldLabel(satellite, isThreatened, isSelected) && point.z > 0.2) {
        labelCandidates.push({
          name: satellite.name,
          point: { x: point.x, y: point.y, z: point.z },
          index: i,
          color,
          isThreatened,
          isSelected,
          // Threatened and selected assets always win space; after that,
          // crewed stations, then navigation, then everything else.
          priority: isThreatened ? 0 : isSelected ? 1 : satellite.group === 'stations' ? 2 : 3,
        })
      }
    }

    this.#placeLabels(labelCandidates)
    return visibleCount
  }

  /**
   * Greedy label placement with collision rejection.
   *
   * The legacy renderer drew every eligible label unconditionally, so on a
   * densely populated view the centre of the globe became an unreadable stack
   * of overlapping pills. Candidates are sorted by priority (then by depth, so
   * nearer satellites win ties) and a label is skipped when its box would
   * overlap one already placed.
   */
  #placeLabels(candidates: LabelCandidate[]): void {
    if (candidates.length === 0) return

    candidates.sort((a, b) => a.priority - b.priority || b.point.z - a.point.z)

    const ctx = this.#ctx
    const placed: { x: number; y: number; width: number; height: number }[] = []
    const limit = this.#labelMode === 'all' ? candidates.length : MAX_SMART_LABELS

    for (const candidate of candidates) {
      if (placed.length >= limit) break

      const label = formatLabel(candidate.name)
      ctx.font =
        candidate.isThreatened || candidate.isSelected
          ? 'bold 9px "JetBrains Mono", monospace'
          : '9px "JetBrains Mono", monospace'

      const textWidth = ctx.measureText(label).width
      const box = this.#labelBox(candidate, textWidth)

      const collides = placed.some(
        (other) =>
          box.x < other.x + other.width &&
          box.x + box.width > other.x &&
          box.y < other.y + other.height &&
          box.y + box.height > other.y,
      )
      // Threats are important enough to draw over a neighbour.
      if (collides && !candidate.isThreatened && !candidate.isSelected) continue

      placed.push(box)
      this.#drawLabel(label, candidate, box)
    }
  }

  #labelBox(
    candidate: LabelCandidate,
    textWidth: number,
  ): { x: number; y: number; width: number; height: number } {
    const { centerX, centerY } = this.#viewport
    const dx = candidate.point.x - centerX
    const dy = candidate.point.y - centerY
    const distance = Math.hypot(dx, dy) || 1
    const x = candidate.point.x + (dx / distance) * 14
    const y = candidate.point.y + (dy / distance) * 14 + (candidate.index % 2 === 0 ? -8 : 8)

    return { x: x - LABEL_PADDING, y: y - LABEL_HEIGHT, width: textWidth + LABEL_PADDING * 2 + 1, height: LABEL_HEIGHT + 2 }
  }

  #shouldLabel(satellite: TrackedSatellite, isThreatened: boolean, isSelected: boolean): boolean {
    if (this.#labelMode === 'none') return false
    if (this.#labelMode === 'all') return true
    if (isThreatened || isSelected) return true
    // Smart mode: named assets only, never the Starlink swarm.
    return satellite.group === 'stations' || satellite.group === 'gps' || satellite.group === 'weather'
  }

  #drawLabel(
    label: string,
    candidate: LabelCandidate,
    box: { x: number; y: number; width: number; height: number },
  ): void {
    const ctx = this.#ctx
    const { point, color, isThreatened, isSelected } = candidate

    const labelColor = isThreatened ? '#ff5555' : isSelected ? '#ffffff' : color
    const alpha = Math.min(1, 0.55 + point.z * 0.45)

    ctx.globalAlpha = alpha * 0.5
    ctx.strokeStyle = labelColor
    ctx.lineWidth = 0.5
    ctx.setLineDash([1, 3])
    ctx.beginPath()
    ctx.moveTo(point.x, point.y)
    ctx.lineTo(box.x, box.y + LABEL_HEIGHT * 0.7)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.globalAlpha = alpha * 0.9
    ctx.fillStyle = 'rgba(1,3,12,.9)'
    ctx.beginPath()
    ctx.roundRect(box.x, box.y, box.width, box.height, 2)
    ctx.fill()

    ctx.fillStyle = labelColor
    ctx.fillRect(box.x, box.y, 1.5, box.height)

    ctx.globalAlpha = alpha
    ctx.fillText(label, box.x + LABEL_PADDING + 2, box.y + LABEL_HEIGHT)
    ctx.globalAlpha = 1
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  #resize(): void {
    const parent = this.#canvas.parentElement
    const width = parent?.clientWidth ?? this.#canvas.clientWidth
    const height = parent?.clientHeight ?? this.#canvas.clientHeight
    if (width === 0 || height === 0) return

    // The legacy renderer ignored devicePixelRatio, so the globe was soft on
    // every high-DPI display.
    const dpr = window.devicePixelRatio || 1
    this.#canvas.width = Math.floor(width * dpr)
    this.#canvas.height = Math.floor(height * dpr)
    this.#canvas.style.width = `${width}px`
    this.#canvas.style.height = `${height}px`
    this.#ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    this.#width = width
    this.#height = height
    this.#radius = Math.min(width, height) * 0.41

    this.#buildBackdrop()
  }

  // ── Interaction ───────────────────────────────────────────────────────────

  #onPointerDown = (event: PointerEvent): void => {
    this.#canvas.setPointerCapture(event.pointerId)
    this.#activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (this.#activePointers.size === 2) {
      const [a, b] = [...this.#activePointers.values()]
      if (a && b) {
        this.#pinchStartDistance = Math.hypot(a.x - b.x, a.y - b.y)
        this.#pinchStartRadius = this.#radius
      }
      this.#dragging = false
      return
    }

    this.#dragging = true
    this.#dragPointerId = event.pointerId
    this.#dragStartX = event.clientX
    this.#dragStartY = event.clientY
    this.#dragStartLon = this.#cameraLon
    this.#dragStartLat = this.#cameraLat
    this.#dragDistance = 0
  }

  #onPointerMove = (event: PointerEvent): void => {
    if (!this.#activePointers.has(event.pointerId)) return
    this.#activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    // Two fingers: pinch to zoom.
    if (this.#activePointers.size === 2) {
      const [a, b] = [...this.#activePointers.values()]
      if (a && b && this.#pinchStartDistance > 0) {
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        this.#setRadius(this.#pinchStartRadius * (distance / this.#pinchStartDistance))
        this.#deferAutoRotate()
      }
      return
    }

    if (!this.#dragging || event.pointerId !== this.#dragPointerId) return

    const dx = event.clientX - this.#dragStartX
    const dy = event.clientY - this.#dragStartY
    this.#dragDistance = Math.max(this.#dragDistance, Math.hypot(dx, dy))

    this.#cameraLon = this.#dragStartLon - dx * 0.35
    this.#cameraLat = Math.max(-75, Math.min(75, this.#dragStartLat + dy * 0.25))
    this.#deferAutoRotate()
  }

  #onPointerUp = (event: PointerEvent): void => {
    const wasDragging = this.#dragging && event.pointerId === this.#dragPointerId
    this.#activePointers.delete(event.pointerId)
    if (this.#activePointers.size < 2) this.#pinchStartDistance = 0

    if (this.#canvas.hasPointerCapture(event.pointerId)) {
      this.#canvas.releasePointerCapture(event.pointerId)
    }

    if (wasDragging) {
      this.#dragging = false
      this.#dragPointerId = null
      // Treat as a tap only if the pointer barely moved.
      if (this.#dragDistance <= 5) this.#selectAt(event.clientX, event.clientY)
    }

    this.#deferAutoRotate()
  }

  #onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    this.#setRadius(this.#radius * (1 + (event.deltaY > 0 ? -0.08 : 0.08)))
    this.#deferAutoRotate()
  }

  /** Keyboard equivalents so the globe is operable without a pointer. */
  #onKeyDown = (event: KeyboardEvent): void => {
    const step = event.shiftKey ? 15 : 5
    switch (event.key) {
      case 'ArrowLeft':
        this.#cameraLon -= step
        break
      case 'ArrowRight':
        this.#cameraLon += step
        break
      case 'ArrowUp':
        this.#cameraLat = Math.min(75, this.#cameraLat + step)
        break
      case 'ArrowDown':
        this.#cameraLat = Math.max(-75, this.#cameraLat - step)
        break
      case '+':
      case '=':
        this.#setRadius(this.#radius * 1.1)
        break
      case '-':
      case '_':
        this.#setRadius(this.#radius * 0.9)
        break
      case 'Escape':
        this.#options.onSelect?.(null)
        return
      default:
        return
    }
    event.preventDefault()
    this.#deferAutoRotate()
  }

  #setRadius(next: number): void {
    const min = Math.min(this.#width, this.#height) * 0.2
    const max = Math.min(this.#width, this.#height) * 0.52
    this.#radius = Math.max(min, Math.min(max, next))
  }

  #deferAutoRotate(): void {
    this.#autoRotateResumeAt = performance.now() + AUTO_ROTATE_RESUME_MS
  }

  /**
   * Hit-tests against positions computed during the last frame rather than
   * re-propagating every satellite, which is both cheaper and guaranteed to
   * agree with what the user actually clicked on.
   */
  #selectAt(clientX: number, clientY: number): void {
    const rect = this.#canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top

    let bestIndex = -1
    let bestDistance = 16

    for (let i = 0; i < this.#screenPositions.length; i += 1) {
      const position = this.#screenPositions[i]
      if (position == null) continue
      const distance = Math.hypot(x - position.x, y - position.y)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = i
      }
    }

    const selected = bestIndex >= 0 ? (this.#satellites[bestIndex]?.id ?? null) : null
    this.#options.onSelect?.(selected)
  }

  #attachListeners(): void {
    this.#canvas.addEventListener('pointerdown', this.#onPointerDown)
    this.#canvas.addEventListener('pointermove', this.#onPointerMove)
    this.#canvas.addEventListener('pointerup', this.#onPointerUp)
    this.#canvas.addEventListener('pointercancel', this.#onPointerUp)
    this.#canvas.addEventListener('wheel', this.#onWheel, { passive: false })
    this.#canvas.addEventListener('keydown', this.#onKeyDown)
  }

  #detachListeners(): void {
    this.#canvas.removeEventListener('pointerdown', this.#onPointerDown)
    this.#canvas.removeEventListener('pointermove', this.#onPointerMove)
    this.#canvas.removeEventListener('pointerup', this.#onPointerUp)
    this.#canvas.removeEventListener('pointercancel', this.#onPointerUp)
    this.#canvas.removeEventListener('wheel', this.#onWheel)
    this.#canvas.removeEventListener('keydown', this.#onKeyDown)
  }
}
