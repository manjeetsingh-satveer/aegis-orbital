import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clientKey, rateLimit, resetRateLimiter } from './rate-limit'

const CONFIG = { limit: 3, windowMs: 1000 }

beforeEach(() => {
  resetRateLimiter()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('rateLimit', () => {
  it('allows requests up to the limit', () => {
    for (let i = 1; i <= CONFIG.limit; i += 1) {
      const result = rateLimit('client-a', CONFIG)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(CONFIG.limit - i)
    }
  })

  it('rejects once the limit is exceeded', () => {
    for (let i = 0; i < CONFIG.limit; i += 1) rateLimit('client-a', CONFIG)

    const result = rateLimit('client-a', CONFIG)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('tracks callers independently', () => {
    for (let i = 0; i < CONFIG.limit; i += 1) rateLimit('client-a', CONFIG)

    expect(rateLimit('client-a', CONFIG).allowed).toBe(false)
    expect(rateLimit('client-b', CONFIG).allowed).toBe(true)
  })

  it('opens a fresh window after expiry', () => {
    for (let i = 0; i < CONFIG.limit; i += 1) rateLimit('client-a', CONFIG)
    expect(rateLimit('client-a', CONFIG).allowed).toBe(false)

    vi.advanceTimersByTime(CONFIG.windowMs + 1)

    const result = rateLimit('client-a', CONFIG)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(CONFIG.limit - 1)
  })

  it('reports a reset timestamp in the future', () => {
    const result = rateLimit('client-a', CONFIG)
    expect(result.resetAt * 1000).toBeGreaterThanOrEqual(Date.now())
  })
})

describe('clientKey', () => {
  it('uses the first x-forwarded-for entry', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18' })
    expect(clientKey(headers)).toBe('203.0.113.7')
  })

  it('trims whitespace', () => {
    expect(clientKey(new Headers({ 'x-forwarded-for': '  203.0.113.7  ' }))).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip', () => {
    expect(clientKey(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
  })

  // A caller with no usable header must still be counted, never exempted.
  it('buckets unidentifiable callers rather than skipping them', () => {
    expect(clientKey(new Headers())).toBe('unknown')
    expect(clientKey(new Headers({ 'x-forwarded-for': '' }))).toBe('unknown')
  })
})
