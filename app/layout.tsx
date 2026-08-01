import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

/**
 * Fonts are self-hosted by next/font rather than pulled from
 * fonts.googleapis.com via an @import inside a <style> block, which blocked
 * first paint and required allowlisting two external origins in the CSP.
 */
const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-mono',
  display: 'swap',
})

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://aegis-orbital.vercel.app'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'AEGIS — Orbital Threat Intelligence Platform',
    template: '%s · AEGIS',
  },
  description:
    'Satellite cyber threat intelligence: live orbital tracking via SGP4 with Isolation Forest anomaly detection across GPS spoofing, jamming, command injection, replay and ground-station phishing.',
  applicationName: 'AEGIS',
  authors: [{ name: 'Manjeet Singh', url: 'https://www.manjeet-singh.com' }],
  keywords: [
    'satellite security',
    'orbital tracking',
    'SGP4',
    'intrusion detection',
    'isolation forest',
    'GPS spoofing',
    'space cybersecurity',
  ],
  openGraph: {
    type: 'website',
    siteName: 'AEGIS',
    title: 'AEGIS — Orbital Threat Intelligence Platform',
    description:
      'Live satellite tracking with SGP4 and a tested Isolation Forest detector for orbital attack signatures.',
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AEGIS — Orbital Threat Intelligence Platform',
    description:
      'Live satellite tracking with SGP4 and a tested Isolation Forest detector for orbital attack signatures.',
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor: '#000205',
  width: 'device-width',
  initialScale: 1,
  // The globe uses pinch-to-zoom, but the page itself must stay zoomable for
  // accessibility, so maximumScale is deliberately not restricted.
  colorScheme: 'dark',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
