import { NextResponse, type NextRequest } from 'next/server'

/**
 * Per-request nonce-based Content Security Policy.
 *
 * The legacy deployment had no CSP at all. It could not have had a useful one:
 * it loaded scripts from jsDelivr, fonts from Google, and data from two CORS
 * proxies, so any policy would have needed to allowlist half the internet.
 *
 * Every one of those dependencies is now first-party — satellite.js and
 * world-atlas are bundled, fonts are self-hosted via next/font, and satellite
 * data comes from our own API route — so `default-src 'self'` is achievable and
 * script-src needs nothing beyond a nonce.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  const csp = [
    "default-src 'self'",
    // `strict-dynamic` lets the nonced Next runtime load its own chunks.
    // `unsafe-eval` is required by React's dev-mode refresh only.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''
    }`,
    // Next injects critical CSS as inline <style>; hashing it per build is not
    // currently supported by the framework, so styles remain the one relaxation.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)

  // HTML must never be cached at the edge, or a deploy leaves users on the old
  // bundle. The legacy vercel.json set max-age=3600 on every path, including
  // the document.
  if (request.headers.get('accept')?.includes('text/html')) {
    response.headers.set('Cache-Control', 'no-cache, must-revalidate')
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except Next's fingerprinted static output and the favicon,
     * which are immutable and need no per-request policy.
     */
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon.svg).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
