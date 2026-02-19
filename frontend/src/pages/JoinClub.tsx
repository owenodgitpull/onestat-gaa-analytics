import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

export default function JoinClub() {
  const { code } = useParams<{ code: string }>();
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const [clubName, setClubName] = useState<string | null>(null);
  const [valid, setValid] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!code) {
      setValid(false);
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const resp = await fetch(`${API_BASE_URL}/auth/invite-code/${code}/verify`);
        const data = await resp.json();
        setValid(data.valid);
        setClubName(data.club_name);
      } catch {
        setValid(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  // If already authenticated, redirect
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleJoin = () => {
    // Store invite code so AuthCallback can pass it to token exchange
    if (code) {
      sessionStorage.setItem('invite_code', code.toUpperCase());
    }
    login(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!valid) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div
          className="w-full max-w-md rounded-2xl p-8 text-center"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.05))',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          <div className="text-red-400 text-4xl mb-4">!</div>
          <h1 className="text-xl font-bold text-white mb-2">Invalid Invite Link</h1>
          <p className="text-white/60 mb-6">
            This invite link is expired or invalid. Ask your manager for a new one.
          </p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="px-6 py-2 rounded-lg bg-white/10 text-white font-medium hover:bg-white/20 transition-colors"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div
        className="w-full max-w-md rounded-2xl p-8 text-center"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.05))',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <img
          src="/oneStatLogoTransparent.png"
          alt="OneStat Analytics"
          className="h-16 mx-auto mb-6"
        />

        <h1 className="text-2xl font-bold text-white mb-2">
          Join {clubName}
        </h1>
        <p className="text-white/60 mb-8">
          You've been invited to join the team. Sign up to access your stats, leaderboards, and more.
        </p>

        <button
          onClick={handleJoin}
          className="relative w-full py-3 px-6 rounded-xl text-white font-semibold text-base transition-all hover:scale-[1.02] active:scale-[0.98] backdrop-blur-md overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(0,230,118,0.25), rgba(0,176,255,0.2))',
            border: '1px solid rgba(0,176,255,0.35)',
            boxShadow: '0 4px 24px rgba(0,230,118,0.15), inset 0 1px 0 rgba(255,255,255,0.1)',
          }}
        >
          <span
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.08) 55%, rgba(255,255,255,0.15) 60%, rgba(255,255,255,0.08) 65%, transparent 80%)',
            }}
          />
          <span className="relative z-10">Sign Up & Join</span>
        </button>

        <p className="text-white/40 text-xs mt-6">
          Already have an account?{' '}
          <button
            onClick={() => { if (code) sessionStorage.setItem('invite_code', code.toUpperCase()); login(); }}
            className="text-emerald-400 hover:text-emerald-300 underline transition-colors"
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}
