import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/** Wipe all auth-related session/local storage so a fresh login starts clean. */
function clearAllAuthState() {
  sessionStorage.removeItem('gaa_user');
  sessionStorage.removeItem('pkce_verifier');
  sessionStorage.removeItem('oauth_state');
  sessionStorage.removeItem('invite_code');
  sessionStorage.removeItem('gaa_auth'); // legacy
}

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const { exchangeCode, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const exchangedRef = useRef(false);

  useEffect(() => {
    if (exchangedRef.current) return;

    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');
    const state = searchParams.get('state');

    if (errorParam) {
      // Cognito returned an error — clean up and redirect to login
      clearAllAuthState();
      navigate('/login', { replace: true });
      return;
    }

    if (!code) {
      if (!isAuthenticated) {
        clearAllAuthState();
        navigate('/login', { replace: true });
      }
      return;
    }

    // Verify OAuth state parameter (CSRF protection)
    const storedState = sessionStorage.getItem('oauth_state');
    sessionStorage.removeItem('oauth_state');

    if (!state || state !== storedState) {
      // Stale callback (e.g. refreshed page with old URL) — just restart login
      clearAllAuthState();
      navigate('/login', { replace: true });
      return;
    }

    exchangedRef.current = true;

    // If user came via an invite link, pass the code to token exchange
    const inviteCode = sessionStorage.getItem('invite_code');
    sessionStorage.removeItem('invite_code');

    exchangeCode(code, inviteCode || undefined).catch(() => {
      // Token exchange failed (expired code, PKCE mismatch, etc.)
      // Clean everything and send user to a fresh login
      clearAllAuthState();
      navigate('/login', { replace: true });
    });
  }, [searchParams, exchangeCode, isAuthenticated, navigate]);

  // Once authenticated, redirect based on whether user has a club
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

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-white/60">Signing you in...</p>
      </div>
    </div>
  );
}
