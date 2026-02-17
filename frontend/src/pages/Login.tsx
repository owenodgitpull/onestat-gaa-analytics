import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { isAuthenticated, isLoading, login } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
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
        {/* Logo */}
        <img
          src="/oneStatLogoTransparent.png"
          alt="OneStat Analytics"
          className="h-24 mx-auto mb-8"
        />
        <p className="text-white/60 mb-8">Sign in with your team account</p>

        <button
          onClick={login}
          className="relative w-full py-3 px-6 rounded-xl text-white font-semibold text-base transition-all hover:scale-[1.02] active:scale-[0.98] backdrop-blur-md overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.2))',
            border: '1px solid rgba(139,92,246,0.35)',
            boxShadow: '0 4px 24px rgba(99,102,241,0.15), inset 0 1px 0 rgba(255,255,255,0.1)',
          }}
        >
          <span
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.08) 55%, rgba(255,255,255,0.15) 60%, rgba(255,255,255,0.08) 65%, transparent 80%)',
            }}
          />
          <span className="relative z-10">Sign In</span>
        </button>

        <p className="text-white/40 text-xs mt-6">
          Don't have an account?{' '}
          <button
            onClick={login}
            className="text-indigo-400 hover:text-indigo-300 underline transition-colors"
          >
            Sign up
          </button>
        </p>
      </div>
    </div>
  );
}
