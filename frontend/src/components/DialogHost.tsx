/**
 * DialogHost — renders the confirm / alert / prompt dialogs requested via
 * utils/dialog.ts using the shared glass ConfirmationModal. Mount once at the
 * app root.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import ConfirmationModal from './ConfirmationModal'
import { registerDialogHost, type DialogRequest } from '../utils/dialog'

export default function DialogHost() {
  const [queue, setQueue] = useState<DialogRequest[]>([])
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const current = queue[0]

  useEffect(() => {
    registerDialogHost(req => setQueue(q => [...q, req]))
    return () => registerDialogHost(null)
  }, [])

  // Reset the prompt field each time a new dialog becomes current
  useEffect(() => {
    if (current?.kind === 'prompt') {
      setText(current.defaultValue ?? '')
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [current])

  const finish = useCallback((value: any) => {
    setQueue(q => {
      q[0]?.resolve(value)
      return q.slice(1)
    })
  }, [])

  // ConfirmationModal calls onConfirm() and then onClose(); only the first
  // resolution counts, so track which one already settled this dialog.
  const settledRef = useRef<DialogRequest | null>(null)
  const settle = useCallback((req: DialogRequest, value: any) => {
    if (settledRef.current === req) return
    settledRef.current = req
    finish(value)
  }, [finish])

  if (!current) return null

  const onConfirm = () =>
    settle(current, current.kind === 'prompt' ? (text.trim() || null) : current.kind === 'confirm' ? true : undefined)
  const onClose = () =>
    settle(current, current.kind === 'confirm' ? false : current.kind === 'prompt' ? null : undefined)

  return (
    <ConfirmationModal
      isOpen
      title={current.title}
      message={current.message ?? ''}
      variant={current.variant ?? 'info'}
      confirmText={current.confirmText ?? (current.kind === 'prompt' ? 'Add' : 'Confirm')}
      cancelText={current.cancelText}
      onConfirm={current.kind === 'alert' ? undefined : onConfirm}
      onClose={onClose}
    >
      {current.kind === 'prompt' && (
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { onConfirm() } }}
          placeholder={current.placeholder}
          className="w-full rounded-xl bg-black/30 border border-white/15 focus:border-emerald-400/60 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors"
        />
      )}
    </ConfirmationModal>
  )
}
