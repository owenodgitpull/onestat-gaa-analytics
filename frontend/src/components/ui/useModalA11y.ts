import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Accessible modal behaviour for an existing dialog panel.
 * - Escape calls onEscape (pass the same guarded close the backdrop uses; omit for non-dismissable dialogs)
 * - focus moves into the panel on open (unless something inside already has it) and is restored on close
 * - Tab / Shift+Tab are trapped inside the panel
 * Put `ref` on the panel and spread `role="dialog" aria-modal="true"` plus aria-label/aria-labelledby on it.
 */
export function useModalA11y<T extends HTMLElement = HTMLDivElement>(
  onEscape?: () => void,
  active: boolean = true,
): RefObject<T> {
  const ref = useRef<T>(null)
  const escRef = useRef(onEscape)
  escRef.current = onEscape

  useEffect(() => {
    if (!active) return
    const prev = document.activeElement as HTMLElement | null
    const panel = ref.current
    if (panel && !panel.contains(document.activeElement)) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE)
      if (first) first.focus({ preventScroll: true })
      else {
        panel.tabIndex = -1
        panel.focus({ preventScroll: true })
      }
    }
    const onKey = (e: KeyboardEvent) => {
      const p = ref.current
      if (!p) return
      if (e.key === 'Escape') {
        // Only the top-most dialog reacts: ignore if focus is in a different dialog
        const ae = document.activeElement
        const owner = ae?.closest?.('[role="dialog"]')
        if (owner && owner !== p) return
        if (escRef.current) {
          e.stopPropagation()
          escRef.current()
        }
        return
      }
      if (e.key !== 'Tab') return
      const owner = document.activeElement?.closest?.('[role="dialog"]')
      if (owner && owner !== p) return
      const items = Array.from(p.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const ae = document.activeElement as HTMLElement | null
      if (e.shiftKey && (ae === first || !p.contains(ae))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (ae === last || !p.contains(ae))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true })
    }
  }, [active])

  return ref
}
