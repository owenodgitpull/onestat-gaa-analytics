import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * Last-resort catch-all so a render-time error anywhere in the tree shows a
 * "reload" prompt instead of a permanently blank screen — React unmounts the
 * whole tree on an uncaught error with nothing here to catch it otherwise.
 * lazyWithRetry (see utils/lazyWithRetry.ts) handles the single most common
 * cause of this (a stale chunk reference after a deploy) by reloading
 * automatically before it ever gets here; this is the net underneath that
 * for anything else that throws during render.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('[ErrorBoundary] Uncaught render error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#0a0e1a' }}>
          <div className="text-center max-w-sm">
            <p className="text-white text-lg font-semibold mb-2">Something went wrong</p>
            <p className="text-white/50 text-sm mb-5">This usually clears up with a refresh.</p>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--gradient-primary)', color: '#0a1a10', border: '1px solid rgba(0,230,118,0.3)' }}
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
