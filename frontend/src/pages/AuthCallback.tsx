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

    exchangeCode(code).catch((err) => {
      setError(err.message || 'Token exchange failed');
    });
  }, [searchParams, exchangeCode, isAuthenticated]);

  // Once authenticated, redirect based on whether user has a club
  useEffect(() => {
    if (isAuthenticated && user) {
      if (!user.club_id) {
        navigate('/onboarding', { replace: true });
      } else if (user.role === 'player') {
        navigate('/player', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    }
  }, [isAuthenticated, user, navigate]);

  // Don't show error if we're already authenticated — navigation will handle it
  if (error && !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div
          className="w-full max-w-md rounded-2xl p-8 text-center"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.05))',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          <div className="text-red-400 text-lg font-semibold mb-2">Authentication Error</div>
          <p className="text-white/60 mb-6">{error}</p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="px-6 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-white/60">Signing you in...</p>
      </div>
    </div>
  );
}
