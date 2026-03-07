import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const { exchangeCode, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const exchangedRef = useRef(false);

  useEffect(() => {
    if (exchangedRef.current) return;

    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');
    const state = searchParams.get('state');

    if (errorParam) {
      setError(`Authentication failed: ${errorParam}`);
      return;
    }

    if (!code) {
      // Don't error if we're already authenticated (navigating away)
      if (!isAuthenticated) {
        setError('No authorization code received');
      }
      return;
    }

    // Verify OAuth state parameter (CSRF protection)
    const storedState = sessionStorage.getItem('oauth_state');
    sessionStorage.removeItem('oauth_state');

    if (!state || state !== storedState) {
      setError('Invalid state parameter — possible CSRF attack. Please try logging in again.');
      return;
    }

    exchangedRef.current = true;

    // If user came via an invite link, pass the code to token exchange
    const inviteCode = sessionStorage.getItem('invite_code');
    sessionStorage.removeItem('invite_code');

    exchangeCode(code, inviteCode || undefined).catch((err) => {
      setError(err.message || 'Token exchange failed');
    });
  }, [searchParams, exchangeCode, isAuthenticated]);

  // Once authenticated, redirect based on whether user has a club
  useEffect(() => {
    if (isAuthenticated && user) {
      if (!user.club_id || !user.onboarding_completed) {
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

  // On error: clear stale session data and redirect to login
  // This replaces the old error card — users shouldn't get stuck here.
  useEffect(() => {
    if (error && !isAuthenticated) {
      console.warn('[auth]', error);
      sessionStorage.removeItem('gaa_user');
      sessionStorage.removeItem('pkce_verifier');
      sessionStorage.removeItem('oauth_state');
      navigate('/login', { replace: true });
    }
  }, [error, isAuthenticated, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-white/60">Signing you in...</p>
      </div>
    </div>
  );
}
