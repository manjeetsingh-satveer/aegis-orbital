import { expect, test } from '@playwright/test'

/**
 * API contract and security-control coverage.
 *
 * Run against the production build — under `next dev` the rate limiter's module
 * state is reset per request, so these assertions only hold against `next start`.
 */

// Rate-limit assertions consume quota, so they must not race other specs.
test.describe.configure({ mode: 'serial' })

test('satellites endpoint returns validated groups', async ({ request }) => {
  const response = await request.get('/api/satellites')
  expect(response.status()).toBe(200)

  const body = await response.json()
  expect(Array.isArray(body.groups)).toBe(true)
  expect(body.groups.length).toBeGreaterThan(0)

  for (const group of body.groups) {
    expect(['starlink', 'stations', 'gps', 'weather']).toContain(group.group)
    expect(['live', 'fallback']).toContain(group.source)
    expect(group.records.length).toBeGreaterThan(0)

    for (const record of group.records.slice(0, 5)) {
      // Element lines are fixed-width; the schema rejects anything else.
      expect(record.line1).toHaveLength(69)
      expect(record.line2).toHaveLength(69)
      expect(record.noradId).toBeGreaterThan(0)
      // Names are sanitised server-side before they reach a canvas or ARIA label.
      expect(record.name).not.toMatch(/[<>]/)
      expect(record.name.length).toBeLessThanOrEqual(32)
    }
  }
})

test('per-group endpoint rejects unknown groups', async ({ request }) => {
  const response = await request.get('/api/tle/not-a-real-group')
  expect(response.status()).toBe(404)
})

test('geo endpoint returns coastline rings', async ({ request }) => {
  const response = await request.get('/api/geo')
  expect(response.status()).toBe(200)

  const body = await response.json()
  expect(body.count).toBeGreaterThan(0)
  expect(Array.isArray(body.rings)).toBe(true)

  const [first] = body.rings
  expect(Array.isArray(first)).toBe(true)
  const [lon, lat] = first[0]
  expect(Math.abs(lon)).toBeLessThanOrEqual(180)
  expect(Math.abs(lat)).toBeLessThanOrEqual(90)
})

test('responses carry hardening headers', async ({ request }) => {
  const response = await request.get('/')
  const headers = response.headers()

  expect(headers['content-security-policy']).toContain("default-src 'self'")
  expect(headers['content-security-policy']).toContain("object-src 'none'")
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(headers['permissions-policy']).toContain('geolocation=()')

  // Next's identifying header is disabled.
  expect(headers['x-powered-by']).toBeUndefined()
})

test('CSP blocks third-party script origins and eval in production', async ({ request }) => {
  const response = await request.get('/')
  const csp = response.headers()['content-security-policy'] ?? ''

  // No external script origin may be allowlisted — everything is first-party.
  expect(csp).toContain("script-src 'self'")
  expect(csp).not.toMatch(/script-src[^;]*https?:/)
  expect(csp).not.toContain("'unsafe-eval'")
  expect(csp).toContain("connect-src 'self'")

  /*
   * 'strict-dynamic' must stay out. Next 16 does not stamp nonces on its
   * streaming RSC payload scripts, and under 'strict-dynamic' browsers ignore
   * 'self' — which blocks every script and leaves the app unhydrated. This
   * assertion exists so a future well-meaning tightening cannot silently ship
   * that breakage again.
   */
  expect(csp).not.toContain('strict-dynamic')
})

test('the production page actually hydrates under its own CSP', async ({ page }) => {
  const blocked: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (/Content Security Policy|Refused to (load|execute)/i.test(text)) blocked.push(text)
  })

  await page.goto('/')

  // Hydration is what turns the server-rendered "0 tracked satellites" into
  // real data; if the CSP blocks scripts this never happens.
  await expect(page.getByRole('application')).toHaveAttribute(
    'aria-label',
    /showing [1-9]\d* tracked satellites/,
    { timeout: 30_000 },
  )
  expect(blocked).toEqual([])
})

test('rate limit headers are present on successful responses', async ({ request }) => {
  const response = await request.get('/api/satellites')
  expect(response.status()).toBe(200)

  // Clients should be able to back off before they are refused.
  expect(Number(response.headers()['ratelimit-limit'])).toBeGreaterThan(0)
  expect(response.headers()['ratelimit-remaining']).toBeDefined()
  expect(Number(response.headers()['ratelimit-reset'])).toBeGreaterThan(0)
})
