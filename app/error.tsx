'use client'

import { useEffect } from 'react'

/**
 * Route-level error boundary. Without one, an unhandled render error leaves the
 * user on a blank page with no way forward.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): React.ReactElement {
  useEffect(() => {
    console.error('[aegis] unhandled render error', {
      message: error.message,
      digest: error.digest,
    })
  }, [error])

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        height: '100dvh',
        padding: 24,
        textAlign: 'center',
        background: 'var(--bg0)',
        color: 'var(--text1)',
      }}
    >
      <h1 style={{ fontSize: 16, letterSpacing: 3, color: 'var(--red)' }}>AEGIS FAULT</h1>
      <p style={{ fontSize: 13, color: 'var(--text2)', maxWidth: 460, lineHeight: 1.6 }}>
        The console hit an unrecoverable error and stopped. Orbital data is unaffected — reloading
        re-fetches it.
      </p>
      {error.digest !== undefined && (
        <code style={{ fontSize: 11, color: 'var(--text3)' }}>ref: {error.digest}</code>
      )}
      <button
        type="button"
        onClick={reset}
        style={{
          marginTop: 8,
          padding: '10px 20px',
          border: '1px solid var(--green)',
          borderRadius: 4,
          color: 'var(--green)',
          background: 'rgba(0,212,160,0.08)',
          fontSize: 12,
          letterSpacing: 1,
        }}
      >
        ↺ Restart console
      </button>
    </main>
  )
}
