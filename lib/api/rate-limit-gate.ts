import { NextResponse } from 'next/server'
import { clientKey, rateLimit, type RateLimitConfig } from '@/lib/rate-limit'

/**
 * Rate-limit gate for route handlers.
 *
 * This lives in the routes rather than the proxy because Next 16's proxy
 * convention does not intercept Route Handlers — a limiter placed there is
 * silently inert, which is worse than none at all because it looks like
 * protection. Routes call `enforceRateLimit` first and merge `headers` into
 * whatever they return.
 */

/**
 * Generous enough that no real session notices, tight enough that the CelesTrak
 * proxy cannot be driven at scale. Successful responses are cached for an hour,
 * so a legitimate visitor makes very few uncached calls.
 */
export const API_RATE_LIMIT: RateLimitConfig = { limit: 60, windowMs: 60_000 }

export interface RateLimitGate {
  /** Non-null when the caller has exceeded the limit; return it immediately. */
  readonly rejection: NextResponse | null
  /** Merge into the success response so clients can back off before refusal. */
  readonly headers: Record<string, string>
}

export function enforceRateLimit(
  request: Request,
  config: RateLimitConfig = API_RATE_LIMIT,
): RateLimitGate {
  const result = rateLimit(`api:${clientKey(request.headers)}`, config)

  const headers: Record<string, string> = {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(result.resetAt),
  }

  if (result.allowed) return { rejection: null, headers }

  return {
    rejection: NextResponse.json(
      { error: 'rate limit exceeded' },
      {
        status: 429,
        headers: {
          ...headers,
          'Retry-After': String(result.retryAfterSeconds),
          'Cache-Control': 'no-store',
        },
      },
    ),
    headers,
  }
}
