import { lazy, type ComponentType } from 'react'

const RELOAD_GUARD_KEY = 'lazy-retry-reload'

/**
 * Wraps React.lazy so a dynamic-import failure — which almost always means
 * "this tab is still running JS from a deploy that's since been replaced,
 * and the hashed chunk filename baked into its already-loaded bundle no
 * longer exists" — triggers exactly one automatic full reload instead of
 * leaving the app on a permanently blank screen. Without this, any tab left
 * open across a deploy shows a blank page the moment it navigates to a
 * lazy route it hadn't already loaded, and the only fix is a manual hard
 * refresh (reported across multiple pages, not just one — every route below
 * is lazy-loaded, so any of them can hit this after a deploy).
 *
 * The sessionStorage guard prevents an infinite reload loop if the failure
 * is a genuine, persistent error rather than a stale-deploy hiccup — after
 * one automatic retry-via-reload this session, a second failure is left to
 * surface normally (Suspense/ErrorBoundary) instead of reloading forever.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors React.lazy's own signature (ComponentType<any>), not a new unsafe pattern
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const mod = await factory()
      sessionStorage.removeItem(RELOAD_GUARD_KEY)
      return mod
    } catch (err) {
      if (!sessionStorage.getItem(RELOAD_GUARD_KEY)) {
        sessionStorage.setItem(RELOAD_GUARD_KEY, '1')
        window.location.reload()
        // Reload is already in flight — never resolve, so nothing else
        // (like an error boundary) races to render before the page turns over.
        return new Promise<{ default: T }>(() => {})
      }
      throw err
    }
  })
}
