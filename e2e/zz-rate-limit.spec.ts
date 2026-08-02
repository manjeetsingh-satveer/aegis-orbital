import { expect, test } from '@playwright/test'

/**
 * Rate-limit enforcement.
 *
 * Deliberately named to sort last. Exhausting the quota is the point of this
 * spec, and the limiter keys on client IP — so running it earlier starves every
 * other spec of satellite data and fails the whole suite. Playwright executes
 * files in alphabetical order, which makes the `zz-` prefix the enforcement
 * mechanism rather than a convention nobody remembers.
 *
 * Only meaningful against a production build: `next dev` re-evaluates modules
 * per request, resetting the limiter's in-memory counters.
 */

test.describe.configure({ mode: 'serial' })

/*
 * Generous: a cold upstream cache means the first calls wait on CelesTrak, and
 * an unreachable CelesTrak costs the full fetch timeout before falling back.
 */
test.setTimeout(180_000)

test('refuses sustained bursts with a Retry-After hint', async ({ request }) => {
  /*
   * Fired concurrently rather than sequentially. Sequential calls serialise
   * behind the upstream fetch and blow the timeout, and a real burst is
   * concurrent anyway.
   */
  const responses = await Promise.all(
    Array.from({ length: 70 }, () => request.get('/api/satellites')),
  )
  const statuses = responses.map((response) => response.status())

  const accepted = statuses.filter((status) => status === 200).length
  const refused = statuses.filter((status) => status === 429).length

  expect(accepted).toBeGreaterThan(0)
  expect(refused).toBeGreaterThan(0)
  // Enforcement should be crisp: allow the quota, refuse the remainder.
  expect(accepted + refused).toBe(70)

  const followUp = await request.get('/api/satellites')
  expect(followUp.status()).toBe(429)
  expect(Number(followUp.headers()['retry-after'])).toBeGreaterThan(0)
  expect(followUp.headers()['ratelimit-remaining']).toBe('0')
  expect(followUp.headers()['cache-control']).toContain('no-store')
})
