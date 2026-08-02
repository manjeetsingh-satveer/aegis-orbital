'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  readonly children: ReactNode
  /** Rendered in place of the subtree when it throws. */
  readonly fallback: ReactNode
  readonly label: string
}

interface State {
  readonly hasError: boolean
}

/**
 * Scoped error boundary.
 *
 * The canvas renderer touches a lot of browser surface — devicePixelRatio,
 * ResizeObserver, Path2D.roundRect, pointer capture. If any of it throws on an
 * unusual browser, this contains the failure to the globe instead of taking the
 * whole console down with it: the alert feed, sandbox and metrics keep working.
 *
 * Must be a class component; React provides no hook equivalent for
 * componentDidCatch.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[aegis] ${this.props.label} failed`, {
      message: error.message,
      componentStack: info.componentStack,
    })
  }

  override render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
