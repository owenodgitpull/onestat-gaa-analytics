/**
 * networkStatus.ts — Three-layer offline detection.
 *
 * Layer 1: navigator.onLine (coarse — can be wrong on captive portals)
 * Layer 2: online/offline window events (reactive)
 * Layer 3: Periodic health-check ping (ground truth, active mode only)
 *
 * Two modes:
 *  - Passive: browser events only (default, used app-wide)
 *  - Active: adds periodic health-check pings (started by match recording)
 *
 * Requires 2 consecutive ping failures before reporting offline to avoid
 * false positives from transient network blips.
 */

type NetworkState = {
  isOnline: boolean
  /** Timestamp of last confirmed connectivity */
  lastOnlineAt: number
}

type Listener = (state: NetworkState) => void

// Use root endpoint — no DB query, just a fast JSON response
const PING_URL = '/'
const ONLINE_POLL_MS = 30_000  // 30s when online
const OFFLINE_POLL_MS = 5_000  // 5s when offline (detect recovery fast)
const CONSECUTIVE_FAILURES_THRESHOLD = 2

let state: NetworkState = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  lastOnlineAt: Date.now(),
}

const listeners = new Set<Listener>()
let pollTimer: ReturnType<typeof setTimeout> | null = null
let passiveStarted = false
let activeMonitoring = false
let consecutiveFailures = 0

function emit() {
  listeners.forEach(fn => {
    try { fn({ ...state }) } catch { /* listener error — don't break others */ }
  })
}

function setOnline(online: boolean) {
  const changed = state.isOnline !== online
  state.isOnline = online
  if (online) state.lastOnlineAt = Date.now()
  if (changed) emit()
}

async function healthCheck() {
  try {
    const baseUrl = import.meta.env.VITE_API_URL || ''
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const resp = await fetch(`${baseUrl}${PING_URL}`, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
      credentials: 'omit',
    })
    clearTimeout(timeout)
    if (resp.ok) {
      consecutiveFailures = 0
      setOnline(true)
    } else {
      consecutiveFailures++
      if (consecutiveFailures >= CONSECUTIVE_FAILURES_THRESHOLD) {
        setOnline(false)
      }
    }
  } catch {
    consecutiveFailures++
    if (consecutiveFailures >= CONSECUTIVE_FAILURES_THRESHOLD) {
      setOnline(false)
    }
  }
  schedulePoll()
}

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer)
  if (!activeMonitoring) return
  pollTimer = setTimeout(healthCheck, state.isOnline ? ONLINE_POLL_MS : OFFLINE_POLL_MS)
}

function handleOnline() {
  consecutiveFailures = 0
  setOnline(true)
  if (activeMonitoring) healthCheck()
}
function handleOffline() {
  setOnline(false)
  if (activeMonitoring) schedulePoll()
}

// ── Public API ───────────────────────────────────────────────────────────

/** Start passive monitoring (browser events only — no pings). Call once at app startup. */
export function startNetworkMonitor() {
  if (passiveStarted) return
  passiveStarted = true
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
}

/** Stop all monitoring (cleanup). */
export function stopNetworkMonitor() {
  passiveStarted = false
  activeMonitoring = false
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
}

/**
 * Enable active health-check pings. Call when entering match recording.
 * Resets state to browser's online status, then verifies with a ping.
 */
export function startActiveMonitoring() {
  if (activeMonitoring) return
  activeMonitoring = true
  consecutiveFailures = 0
  // Trust the browser first — don't show red until pings actually fail
  if (navigator.onLine && !state.isOnline) {
    setOnline(true)
  }
  healthCheck()
}

/**
 * Disable active health-check pings. Call when leaving match recording.
 * Resets to browser's online status to avoid stale offline state.
 */
export function stopActiveMonitoring() {
  activeMonitoring = false
  consecutiveFailures = 0
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
  // Reset to browser state so stale offline doesn't persist
  if (navigator.onLine && !state.isOnline) {
    setOnline(true)
  }
}

export function getNetworkState(): NetworkState {
  return { ...state }
}

export function isOnline(): boolean {
  return state.isOnline
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Force an immediate health check (e.g. after enqueuing an item) */
export function triggerHealthCheck() {
  if (passiveStarted) healthCheck()
}
