/**
 * App-wide replacement for the browser's native confirm() / alert() / prompt().
 *
 * Native dialogs ("app.onestat.ai says…") look unprofessional and can't be
 * styled, so everything goes through these promise-based helpers, which render
 * the shared glass ConfirmationModal via <DialogHost /> (mounted once in App.tsx).
 *
 *   if (!(await confirmDialog({ title: 'Delete?', message: '…', variant: 'danger' }))) return
 *   await alertDialog({ title: 'Export failed', message: 'Please try again.' })
 *   const text = await promptDialog({ title: 'Label', placeholder: 'e.g. Press' })
 */

export type DialogVariant = 'danger' | 'warning' | 'info'

export interface DialogRequest {
  kind: 'confirm' | 'alert' | 'prompt'
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  variant?: DialogVariant
  placeholder?: string
  defaultValue?: string
  resolve: (value: any) => void
}

type Listener = (req: DialogRequest) => void
let listener: Listener | null = null

export function registerDialogHost(fn: Listener | null) {
  listener = fn
}

function open<T>(req: Omit<DialogRequest, 'resolve'>, fallback: T): Promise<T> {
  return new Promise<T>(resolve => {
    // No host mounted (shouldn't happen) — resolve safely, never fall back to native
    if (!listener) return resolve(fallback)
    listener({ ...req, resolve })
  })
}

export function confirmDialog(opts: {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  variant?: DialogVariant
}): Promise<boolean> {
  return open<boolean>({ kind: 'confirm', variant: 'warning', ...opts }, false)
}

export function alertDialog(
  opts: string | { title: string; message?: string; variant?: DialogVariant },
): Promise<void> {
  const o = typeof opts === 'string' ? { title: opts } : opts
  return open<void>({ kind: 'alert', variant: 'info', ...o }, undefined)
}

export function promptDialog(opts: {
  title: string
  message?: string
  placeholder?: string
  defaultValue?: string
  confirmText?: string
  cancelText?: string
}): Promise<string | null> {
  return open<string | null>({ kind: 'prompt', variant: 'info', ...opts }, null)
}
