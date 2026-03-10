import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE } from '../services/api';

interface InvitationInfo {
  valid: boolean;
  status: string;
  club_name: string;
  club_short_name: string | null;
  inviter_name: string;
  role: string;
  invitee_email: string;
  expired: boolean;
}

export default function InvitationPage() {
  const { token } = useParams<{ token: string }>();
  const { isAuthenticated, user, login } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const resp = await fetch(`${API_BASE}/invitations/${token}/info`);
        const data = await resp.json();
        setInfo(data);
      } catch {
        setInfo(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleAccept = async () => {
    if (!token || accepting) return;
    setAccepting(true);
    try {
      const resp = await fetch(`${API_BASE}/invitations/${token}/accept`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await resp.json();
      if (resp.ok) {
        setResult({ type: 'success', message: data.detail || `Welcome to ${data.club_name}!` });
        setTimeout(() => navigate('/', { replace: true }), 2000);
      } else {
        setResult({ type: 'error', message: data.detail || 'Failed to accept invitation' });
      }
    } catch {
      setResult({ type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setAccepting(false);
    }
  };

  const handleDecline = async () => {
    if (!token || declining) return;
    setDeclining(true);
    try {
      const resp = await fetch(`${API_BASE}/invitations/${token}/decline`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await resp.json();
      if (resp.ok) {
        setResult({ type: 'success', message: 'Invitation declined.' });
        setTimeout(() => navigate('/', { replace: true }), 1500);
      } else {
        setResult({ type: 'error', message: data.detail || 'Failed to decline' });
      }
    } catch {
      setResult({ type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setDeclining(false);
    }
  };

  const handleLoginToAccept = () => {
    if (token) {
      sessionStorage.setItem('invitation_token', token);
    }
    login();
  };

  const handleSignUpToAccept = () => {
    if (token) {
      sessionStorage.setItem('invitation_token', token);
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

  // Invalid or expired
  if (!info || !info.valid) {
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
          <h1 className="text-xl font-bold text-white mb-2">
            {info?.expired ? 'Invitation Expired' : 'Invalid Invitation'}
          </h1>
          <p className="text-white/60 mb-6">
            {info?.expired
              ? 'This invitation has expired. Ask your team admin to send a new one.'
              : info?.status === 'accepted'
                ? "This invitation has already been accepted."
                : info?.status === 'declined'
                  ? "This invitation was declined."
                  : 'This invitation link is invalid.'}
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

  const roleDisplay = info.role === 'club_admin' ? 'an Admin' : 'a Player';

  // Result state (success/error after action)
  if (result) {
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
          <div className={`text-4xl mb-4 ${result.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
            {result.type === 'success' ? '✓' : '!'}
          </div>
          <p className="text-white text-lg font-semibold">{result.message}</p>
          {result.type === 'success' && (
            <p className="text-white/40 text-sm mt-2">Redirecting...</p>
          )}
        </div>
      </div>
    );
  }

  // Authenticated — show accept/decline
  if (isAuthenticated && user) {
    const emailMismatch = info.invitee_email.toLowerCase() !== user.email?.toLowerCase();

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
            Join {info.club_name}
          </h1>
          <p className="text-white/60 mb-2">
            <strong className="text-white">{info.inviter_name}</strong> has invited you as {roleDisplay}.
          </p>

          {emailMismatch && (
            <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-amber-300 text-sm">
                This invitation was sent to <strong>{info.invitee_email}</strong> but you're signed in as <strong>{user.email}</strong>. Please sign in with the correct account.
              </p>
            </div>
          )}

          {!emailMismatch && (
            <div className="flex flex-col gap-3 mt-6">
              <button
                onClick={handleAccept}
                disabled={accepting}
                className="relative w-full py-3 px-6 rounded-xl text-white font-semibold text-base transition-all hover:scale-[1.02] active:scale-[0.98] backdrop-blur-md overflow-hidden disabled:opacity-50"
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
                <span className="relative z-10">
                  {accepting ? 'Accepting...' : 'Accept Invitation'}
                </span>
              </button>
              <button
                onClick={handleDecline}
                disabled={declining}
                className="w-full py-2.5 px-6 rounded-xl text-white/50 font-medium text-sm hover:text-white/80 hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                {declining ? 'Declining...' : 'Decline'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Not authenticated — show login/signup options
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
          Join {info.club_name}
        </h1>
        <p className="text-white/60 mb-8">
          <strong className="text-white">{info.inviter_name}</strong> has invited you as {roleDisplay}. Sign up or sign in to accept.
        </p>

        <button
          onClick={handleSignUpToAccept}
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
          <span className="relative z-10">Sign Up & Accept</span>
        </button>

        <p className="text-white/40 text-xs mt-6">
          Already have an account?{' '}
          <button
            onClick={handleLoginToAccept}
            className="text-emerald-400 hover:text-emerald-300 underline transition-colors"
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}
