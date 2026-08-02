/**
 * Fixed-window rate limiter.
 *
 * The satellite routes proxy CelesTrak. Without a limit an unauthenticated
 * caller could use this deployment to hammer an upstream that asks clients to
 * be considerate — turning AEGIS into an amplification vector against a service
 * it depends on.
 *
 * State is per-instance and in-memory. On a serverless platform each instance
 * keeps its own counters, so this bounds abuse per instance rather than
 * globally; a shared store (Upstash, Vercel KV) would be required for a strict
 * global limit. It is deliberately dependency-free — the responses it protects
 * are cached for an hour, so per-instance bounding is sufficient here.
 */

export interface RateLimitConfig {
  readonly limit: number
  readonly windowMs: number
}

export interface RateLimitResult {
  readonly allowed: boolean
  readonly limit: number
  readonly remaining: number
  /** Unix seconds at which the current window resets. */
  readonly resetAt: number
  /** Seconds until reset; only meaningful when `allowed` is false. */
  readonly retryAfterSeconds: number
}

interface Window {
  count: number
  expiresAt: number
}

const windows = new Map<string, Window>()

/** Bounds memory if a large number of distinct keys is seen. */
const MAX_TRACKED_KEYS = 10_000

function evictExpired(now: number): void {
  for (const [key, window] of windows) {
    if (window.expiresAt <= now) windows.delete(key)
  }
}

export function rateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now()

  if (windows.size > MAX_TRACKED_KEYS) evictExpired(now)

  const existing = windows.get(key)
  const window: Window =
    existing === undefined || existing.expiresAt <= now
      ? { count: 0, expiresAt: now + config.windowMs }
      : existing

  window.count += 1
  windows.set(key, window)

  const allowed = window.count <= config.limit
  const resetAt = Math.ceil(window.expiresAt / 1000)

  return {
    allowed,
    limit: config.limit,
    remaining: Math.max(0, config.limit - window.count),
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((window.expiresAt - now) / 1000)),
  }
}

/** Test seam. */
export function resetRateLimiter(): void {
  windows.clear()
}

/**
 * Derives a client key from proxy headers.
 *
 * These headers are attacker-controllable in general, but on Vercel the
 * platform overwrites x-forwarded-for at the edge. The fallback bucket means a
 * request with no usable header is still counted rather than exempt.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded !== null && forwarded.length > 0) {
    const first = forwarded.split(',')[0]?.trim()
    if (first !== undefined && first.length > 0) return first
  }
  return headers.get('x-real-ip') ?? 'unknown'
}
