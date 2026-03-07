import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { ReactNode } from 'react';

interface RequireAuthProps {
  children: ReactNode;
  requiredRole?: 'club_admin' | 'player';
}

export default function RequireAuth({ children, requiredRole }: RequireAuthProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Redirect to onboarding if club setup is incomplete
  if (user && user.club_id && !user.onboarding_completed && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  // Role-based redirects
  if (user && requiredRole) {
    if (requiredRole === 'club_admin' && user.role === 'player') {
      return <Navigate to="/player" replace />;
    }
    if (requiredRole === 'player' && user.role !== 'player') {
      return <Navigate to="/" replace />;
    }
  }

  // Auto-redirect: players hitting admin routes → /player
  // Exempt /select-player (new players need to pick their name before entering portal)
  if (user?.role === 'player' && !location.pathname.startsWith('/player') && location.pathname !== '/onboarding' && location.pathname !== '/select-player') {
    // If player hasn't selected their player profile yet, redirect to selection
    if (!user.player_id) {
      return <Navigate to="/select-player" replace />;
    }
    return <Navigate to="/player" replace />;
  }

  return <>{children}</>;
}
