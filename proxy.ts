import { NextResponse, type NextRequest } from 'next/server'

/**
 * Request proxy — Content Security Policy and document cache control.
 *
 * Next 16 renamed the `middleware` file convention to `proxy`; this is the same
 * request interception point under its current name.
 *
 * The legacy deployment had no CSP at all, and could not have had a useful one:
 * it loaded scripts from jsDelivr, fonts from Google, and data from two CORS
 * proxies, so any policy would have had to allowlist half the internet. Every
 * one of those dependencies is now first-party — satellite.js and world-atlas
 * are bundled, fonts are self-hosted via next/font, satellite data comes from
 * our own routes — which is what makes `default-src 'self'` achievable.
 *
 * On `script-src 'unsafe-inline'`
 * ------------------------------
 * A nonce-based policy was implemented first and then removed, because it does
 * not work here and failed *silently in production only*:
 *
 *   - Next streams the RSC payload through six inline <script> tags.
 *   - Next 16 with Turbopack does not stamp a nonce onto those tags. Verified
 *     against a production build: 14 script tags, 0 carrying a nonce, with the
 *     nonce set on both the response and the request `Content-Security-Policy`
 *     header as the framework documents.
 *   - Under `'strict-dynamic'` browsers ignore `'self'`, so an unstamped page
 *     has *every* script blocked: the app serves HTML and never hydrates.
 *
 * A policy that breaks the application is worth less than an honest weaker one.
 * `'self'` still blocks every third-party script origin and `'unsafe-eval'` is
 * withheld in production; the residual inline-script risk is small here because
 * there is no user-generated HTML, React escapes all interpolation, and remote
 * satellite names are sanitised server-side before reaching the DOM or canvas.
 *
 * Revisit once the framework stamps nonces on its streaming payload.
 */
export default function proxy(request: NextRequest): NextResponse {
  const isDevelopment = process.env.NODE_ENV === 'development'

  const csp = [
    "default-src 'self'",
    // See the note above on why this is not nonce-based.
    // 'unsafe-eval' is required by React Fast Refresh in development only.
    `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    // Next injects critical CSS as inline <style>; per-build hashing is not
    // supported by the framework.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // Dev needs the HMR websocket; production talks only to its own origin.
    `connect-src 'self'${isDevelopment ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ')

  const response = NextResponse.next()
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
     * Document requests only.
     *
     * Next 16's proxy convention does not intercept Route Handlers — verified
     * empirically: a debug header set here never appeared on /api/* responses.
     * Rate limiting therefore lives inside the route handlers themselves (see
     * lib/api/rate-limit-gate.ts), which is also the more testable place for it.
     *
     * Next's fingerprinted output and the icons are immutable and need no
     * per-request policy; prefetches are skipped so a hovered link does not
     * consume a nonce.
     */
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
