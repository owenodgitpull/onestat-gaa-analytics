import { useState, useEffect, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const INSTALL_DISMISSED_KEY = 'gaa-pwa-install-dismissed';

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true
  );
}

function isIOS(): boolean {
  // iPadOS 13+ reports as macOS in user agent — detect via touch support
  if ((navigator as any).standalone !== undefined) return true;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream) return true;
  // iPadOS 13+: navigator.platform is "MacIntel" but has touch
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  return false;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(INSTALL_DISMISSED_KEY) === '1'; } catch { return false; }
  });
  const [installed, setInstalled] = useState(isStandalone);

  // Listen for the native install prompt (Chrome/Edge/Samsung — not Safari)
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);

    const installedHandler = () => setInstalled(true);
    window.addEventListener('appinstalled', installedHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === 'accepted') {
      setInstalled(true);
      return true;
    }
    return false;
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try { localStorage.setItem(INSTALL_DISMISSED_KEY, '1'); } catch { /* noop */ }
  }, []);

  const canPrompt = !installed && !dismissed;
  const showNativePrompt = canPrompt && !!deferredPrompt; // Android/Chrome
  const showIOSPrompt = canPrompt && !deferredPrompt && isIOS(); // iOS Safari

  return { showNativePrompt, showIOSPrompt, install, dismiss, installed };
}
