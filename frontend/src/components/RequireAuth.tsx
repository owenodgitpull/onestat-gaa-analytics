import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { ReactNode } from 'react';

interface RequireAuthProps {
  children: ReactNode;
  requiredRole?: 'club_admin' | 'player';
}

export default function RequireAuth({ children, requiredRole }: RequireAuthProps) {
  const { isAuthenticated, isLoading, user, previewPlayer } = useAuth();
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

  // Read-only viewers never see Settings (Club Profile, Knowledge Base,
  // Audit Log, User Management) — everything else in the admin app is
  // readable for them, this is the one page that's fully off-limits.
  if (user?.role === 'viewer' && location.pathname.startsWith('/settings')) {
    return <Navigate to="/" replace />;
  }

  // Auto-redirect: players hitting admin routes → /player portal
  // /player and /player/* are player portal routes; /players/* are admin routes
  // Exempt /select-player (new players need to pick their name before entering portal)
  const isPlayerPortalRoute = location.pathname === '/player' || location.pathname.startsWith('/player/')
  if (user?.role === 'player' && !isPlayerPortalRoute && location.pathname !== '/onboarding' && location.pathname !== '/select-player') {
    if (!user.player_id) {
      return <Navigate to="/select-player" replace />;
    }
    return <Navigate to="/player" replace />;
  }

  // Auto-redirect: admins hitting player portal routes → dashboard.
  // Exception: an admin with an active "preview as player" session is meant
  // to be here — that's the whole point of the feature.
  const isAdminPreviewing = user?.role === 'club_admin' && !!previewPlayer;
  if (user?.role !== 'player' && isPlayerPortalRoute && !isAdminPreviewing) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
