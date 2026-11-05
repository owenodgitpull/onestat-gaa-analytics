import { useModalA11y } from './useModalA11y'

/**
 * Drop-in dialog semantics for an existing modal panel without restructuring it.
 * Render as the FIRST CHILD of the panel element:
 *   <div className="panel"><ModalA11y label="Reset match" onEscape={close} /> ...</div>
 * It marks the parent as role="dialog" aria-modal, names it, handles Escape,
 * moves focus in / restores it on close, and traps Tab. Renders nothing visible.
 */
export function ModalA11y({ label, onEscape }: { label: string; onEscape?: () => void }) {
  const panelRef = useModalA11y<HTMLElement>(onEscape)

  return (
    <span
      hidden
      ref={(el) => {
        const panel = el?.parentElement ?? null
        ;(panelRef as { current: HTMLElement | null }).current = panel
        if (panel) {
          panel.setAttribute('role', 'dialog')
          panel.setAttribute('aria-modal', 'true')
          panel.setAttribute('aria-label', label)
        }
      }}
    />
  )
}
