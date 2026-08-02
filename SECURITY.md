# Security Policy

## Reporting a vulnerability

Report suspected vulnerabilities through
[GitHub Security Advisories](https://github.com/manjeetsingh-satveer/aegis-orbital/security/advisories/new)
rather than a public issue. Expect an acknowledgement within seven days.

Please include reproduction steps, the affected version or commit, and the impact
you believe it has.

## Scope

AEGIS is a demonstration and research tool. It has no authentication, stores no
user data, and holds no secrets. The realistic attack surface is therefore
small, and consists of:

| Surface | Concern |
|---|---|
| `/api/satellites`, `/api/tle/[group]` | Server-side fetch to a third-party origin (CelesTrak) |
| Satellite names from CelesTrak | Untrusted strings rendered to DOM, canvas, and ARIA labels |
| `/api/geo` | Static, bundled geometry — no upstream, no user input |

## Threat model and controls

**Untrusted upstream content.** Satellite names come from a remote feed. They
are sanitised server-side in `lib/orbital/celestrak.ts` — control characters and
angle brackets stripped, length capped at 32 — before they reach any renderer.
The response is then validated against a Zod schema in the route handler, so a
malformed payload fails on our side rather than in a browser. React escapes
interpolation, but the canvas renderer and ARIA labels do not, which is why
sanitising at ingest rather than at render is the control that matters.

The pre-3.0 build fetched CelesTrak directly from the browser and, on CORS
failure, fell through to `api.allorigins.win` and `corsproxy.io`. Those
third parties could return arbitrary bytes, which were then interpolated into
`innerHTML`. Both the proxies and the injection sink were removed in the 3.0
rewrite; fetching server-side means there is no CORS constraint and so no reason
for a proxy to exist.

**Upstream amplification.** The satellite routes proxy CelesTrak, a free service
that asks clients to be considerate. Two controls apply: the upstream fetch is
cached for one hour (`lib/orbital/celestrak.ts`), so CelesTrak sees at most one
request per group per hour regardless of traffic; and the route handlers enforce
a 60 request/minute per-client limit (`lib/api/rate-limit-gate.ts`).

The rate limiter keeps state in memory, per instance. On a serverless platform
each instance counts independently, so it bounds abuse per instance rather than
globally. A shared store would be required for a strict global limit; the
one-hour upstream cache is what actually protects CelesTrak.

**Transport and browser controls.** Set in `proxy.ts` and `next.config.ts`:
`Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and
`Cross-Origin-Opener-Policy`. The document is served `no-cache` so a deployment
cannot leave users on a stale bundle.

### Known limitation: `script-src 'unsafe-inline'`

The CSP permits inline scripts. This is deliberate and documented rather than an
oversight.

A nonce-based policy was implemented and then removed. Next 16 streams its React
Server Component payload through inline `<script>` tags and does not stamp a
nonce onto them — verified against a production build: 14 script tags, none
carrying a nonce, with the nonce present on both the response and request
`Content-Security-Policy` headers as the framework documents. Because
`'strict-dynamic'` causes browsers to ignore `'self'`, the result was that every
script on the page was blocked and the application never hydrated. That failure
did not reproduce under `next dev`.

A policy that breaks the application protects nobody. The shipped policy still
blocks all third-party script origins, withholds `'unsafe-eval'` in production,
and sets `object-src 'none'`, `base-uri 'none'`, and `frame-ancestors 'none'`.
The residual risk from inline scripts is low here: there is no user-generated
HTML, no authentication or session to steal, and remote strings are sanitised at
ingest. An end-to-end test asserts `'strict-dynamic'` stays absent so a future
tightening cannot silently reintroduce the breakage.

This will be revisited when the framework stamps nonces on its streaming payload.

## Supply chain

- Dependencies are audited in CI; the build fails on high-severity advisories.
- Dependabot proposes weekly npm and monthly Actions updates.
- CodeQL runs `security-extended` on every push, pull request, and weekly.
- `postcss` and `sharp` are pinned forward via npm `overrides`, because Next
  pins versions carrying published advisories and npm's suggested remedy is a
  downgrade to Next 9.

## What this project is not

AEGIS does not connect to real satellite telemetry. Operators do not publish
uplink SNR or telecommand rates. All telemetry in the threat sandbox is
simulated, and the UI labels it as such. Nothing here should be treated as an
operational security control for a real space system.
