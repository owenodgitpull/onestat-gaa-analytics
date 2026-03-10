import { useState } from 'react'
import { Download, X, Share, PlusSquare } from 'lucide-react'
import { usePWAInstall } from '@/hooks/usePWAInstall'

export default function InstallBanner() {
  const { showNativePrompt, showIOSPrompt, install, dismiss } = usePWAInstall()
  const [iosExpanded, setIosExpanded] = useState(false)

  if (!showNativePrompt && !showIOSPrompt) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[999] safe-area-bottom">
      <div className="mx-3 mb-3 rounded-2xl bg-gradient-to-r from-emerald-600/95 to-cyan-600/95 backdrop-blur-xl shadow-2xl border border-white/20 overflow-hidden">
        {/* Main banner row */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <Download size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm">Install OneStat</p>
            <p className="text-white/70 text-xs">
              {showIOSPrompt
                ? 'Add to your home screen for the full app experience'
                : 'Install for offline access and faster loading'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {showNativePrompt && (
              <button
                onClick={install}
                className="px-4 py-2 rounded-xl bg-white text-emerald-700 font-semibold text-sm active:scale-95 transition-transform touch-manipulation"
              >
                Install
              </button>
            )}
            {showIOSPrompt && (
              <button
                onClick={() => setIosExpanded(prev => !prev)}
                className="px-4 py-2 rounded-xl bg-white text-emerald-700 font-semibold text-sm active:scale-95 transition-transform touch-manipulation"
              >
                How to
              </button>
            )}
            <button
              onClick={dismiss}
              className="p-2 rounded-lg text-white/60 active:bg-white/10 touch-manipulation"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* iOS instructions (expandable) */}
        {showIOSPrompt && iosExpanded && (
          <div className="px-4 pb-4 pt-1 border-t border-white/15">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white text-sm font-bold">1</div>
                <div className="flex items-center gap-2 text-white text-sm">
                  Tap the <Share size={16} className="text-white/90" /> Share button in Safari
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white text-sm font-bold">2</div>
                <div className="flex items-center gap-2 text-white text-sm">
                  Scroll down and tap <PlusSquare size={16} className="text-white/90" /> Add to Home Screen
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white text-sm font-bold">3</div>
                <p className="text-white text-sm">Tap <span className="font-semibold">Add</span></p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
