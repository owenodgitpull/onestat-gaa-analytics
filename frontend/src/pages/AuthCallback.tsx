import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * OAuth callback handler.
 *
 * Flow:
 * 1. Cognito redirects here with ?code=...&state=...
 * 2. We verify the state matches what we stored (CSRF protection)
 * 3. We send the code + PKCE verifier to our backend for token exchange
 * 4. On success → redirect to dashboard / onboarding
 * 5. On failure → full logout (clears httpOnly cookies + Cognito session)
 *    so the user lands on a clean /login without a redirect loop
 */
export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const { exchangeCode, logout, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [failing, setFailing] = useState(false);

  // Guard: entire callback logic must only execute once.
  // useRef survives StrictMode double-invocation in dev.
  const processedRef = useRef(false);

  useEffect(() => {
    // Strict guard — never run twice
    if (processedRef.current) return;
    processedRef.current = true;

    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');
    const state = searchParams.get('state');

    // ── Cognito returned an error (e.g. user cancelled) ──
    if (errorParam) {
      doFullLogout();
      return;
    }

    // ── No code at all (direct navigation to /auth/callback) ──
    if (!code) {
      if (!isAuthenticated) {
        doFullLogout();
      }
      return;
    }

    // ── Verify OAuth state parameter (CSRF protection) ──
    const storedState = sessionStorage.getItem('oauth_state');
    sessionStorage.removeItem('oauth_state');

    if (!state || state !== storedState) {
      // Stale URL (e.g. page refreshed with yesterday's callback URL).
      // State was consumed or never existed — cannot safely proceed.
      doFullLogout();
      return;
    }

    // ── Exchange code for tokens ──
    const inviteCode = sessionStorage.getItem('invite_code');
    sessionStorage.removeItem('invite_code');

    exchangeCode(code, inviteCode || undefined).catch(() => {
      // Exchange failed (expired code, PKCE mismatch, backend error).
      // Full logout ensures no stale cookies cause a loop.
      doFullLogout();
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once authenticated, redirect based on user state
  useEffect(() => {
    if (isAuthenticated && user) {
      if (!user.club_id) {
        navigate('/onboarding', { replace: true });
      } else if (user.role === 'player' && !user.player_id) {
        navigate('/select-player', { replace: true });
      } else if (user.role === 'player') {
        navigate('/player', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    }
  }, [isAuthenticated, user, navigate]);

  /**
   * Full logout: clears httpOnly cookies (via backend), ends the Cognito
   * hosted UI session, and redirects to /login. This ensures no loop.
   */
  function doFullLogout() {
    // Show fallback UI briefly while logout completes
    setFailing(true);
    // logout() clears cookies via backend then redirects to Cognito /logout
    // which in turn redirects to /login with a clean slate.
    logout().catch(() => {
      // If even logout fails (e.g. backend down), redirect directly
      window.location.href = '/login';
    });
  }

  if (failing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/60">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-white/60">Signing you in...</p>
      </div>
    </div>
  );
}
