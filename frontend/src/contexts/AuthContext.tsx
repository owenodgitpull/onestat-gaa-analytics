import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { generateCodeVerifier, generateCodeChallenge } from '../lib/pkce';

const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN;

function mapApiUser(data: Record<string, unknown>): AuthUser {
  return {
    id: data.id as string,
    email: data.email as string,
    name: data.name as string,
    club_id: (data.club_id as string) || null,
    role: data.role as string,
    player_id: (data.player_id as string) || null,
    is_active: data.is_active as boolean,
    onboarding_completed: (data.onboarding_completed as boolean) ?? true,
    trial_ends_at: (data.trial_ends_at as string) ?? null,
    trial_days_remaining: (data.trial_days_remaining as number) ?? null,
    trial_expired: (data.trial_expired as boolean) ?? false,
    subscription_tier: (data.subscription_tier as string) ?? null,
    on_paid_plan: (data.on_paid_plan as boolean) ?? false,
    effective_tier: (data.effective_tier as string) ?? null,
  };
}
const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;
const COGNITO_REDIRECT_URI = import.meta.env.VITE_COGNITO_REDIRECT_URI;
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

/** Session storage key for cached user info (NOT tokens — those are httpOnly cookies). */
const USER_STORAGE_KEY = 'gaa_user';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  club_id: string | null;
  role: string;
  player_id: string | null;
  is_active: boolean;
  onboarding_completed: boolean;
  // Trial / subscription
  trial_ends_at?: string | null;
  trial_days_remaining?: number | null;
  trial_expired?: boolean;
  subscription_tier?: string | null;
  on_paid_plan?: boolean;
  effective_tier?: string | null; // 'club' | 'pro' | 'elite' | null (locked)
}

export interface PreviewPlayer {
  id: string;
  name: string;
}

const PREVIEW_ID_KEY = 'gaa_preview_player_id';
const PREVIEW_NAME_KEY = 'gaa_preview_player_name';

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (signUp?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  exchangeCode: (code: string, inviteCode?: string) => Promise<void>;
  setUser: (user: AuthUser) => void;
  previewPlayer: PreviewPlayer | null;
  startPreview: (player: PreviewPlayer) => void;
  exitPreview: () => void;
  /** Read-only staff — can see everything an admin sees but can't create/edit/delete. */
  isViewer: boolean;
  /** False for viewers (and for players, who have no admin-side write access at all). */
  canEdit: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
  exchangeCode: async () => {},
  setUser: () => {},
  previewPlayer: null,
  startPreview: () => {},
  exitPreview: () => {},
  isViewer: false,
  canEdit: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const refreshRetryCount = useRef(0);

  const [previewPlayer, setPreviewPlayer] = useState<PreviewPlayer | null>(() => {
    const id = sessionStorage.getItem(PREVIEW_ID_KEY);
    const name = sessionStorage.getItem(PREVIEW_NAME_KEY);
    return id && name ? { id, name } : null;
  });

  const startPreview = useCallback((player: PreviewPlayer) => {
    sessionStorage.setItem(PREVIEW_ID_KEY, player.id);
    sessionStorage.setItem(PREVIEW_NAME_KEY, player.name);
    setPreviewPlayer(player);
    // Fire-and-forget audit record — don't block the preview UI on it
    fetch(`${API_BASE_URL}/auth/preview-player/${player.id}`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
  }, []);

  const exitPreview = useCallback(() => {
    sessionStorage.removeItem(PREVIEW_ID_KEY);
    sessionStorage.removeItem(PREVIEW_NAME_KEY);
    setPreviewPlayer(null);
  }, []);

  const isAuthenticated = !!user;
  const isViewer = user?.role === 'viewer';
  const canEdit = user?.role === 'club_admin';

  // Persist user info to sessionStorage (NOT tokens)
  const persistUser = useCallback((u: AuthUser, expiresIn: number) => {
    sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify({
      user: u,
      expires_at: Date.now() + expiresIn * 1000,
    }));
  }, []);

  // Set user with sessionStorage sync
  const setUser = useCallback((u: AuthUser) => {
    setUserState(u);
    const stored = sessionStorage.getItem(USER_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        parsed.user = u;
        sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(parsed));
      } catch {
        // ignore
      }
    }
  }, []);

  // Schedule cookie refresh before expiry.
  // On server errors (503 etc.) or network failures, retries with exponential backoff
  // rather than clearing the session — prevents logout during Fly.io machine restarts.
  const scheduleRefresh = useCallback((expiresIn: number) => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    // Refresh 60 seconds before expiry (minimum 10s delay)
    const delay = Math.max((expiresIn - 60) * 1000, 10000);
    refreshTimeoutRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (resp.ok) {
          refreshRetryCount.current = 0;
          const data = await resp.json();
          scheduleRefresh(data.expires_in || 3600);
          const stored = sessionStorage.getItem(USER_STORAGE_KEY);
          if (stored) {
            const parsed = JSON.parse(stored);
            parsed.expires_at = Date.now() + (data.expires_in || 3600) * 1000;
            sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(parsed));
          }
        } else if (resp.status === 401 || resp.status === 403) {
          // Genuine auth rejection — session is invalid
          setUserState(null);
          sessionStorage.removeItem(USER_STORAGE_KEY);
        } else {
          // Server error (503, 502, etc.) — keep session alive and retry with backoff
          const backoffSecs = Math.min(Math.pow(2, refreshRetryCount.current) * 2 + 60, 120);
          refreshRetryCount.current += 1;
          scheduleRefresh(backoffSecs);
        }
      } catch {
        // Network error — keep session alive and retry with backoff
        const backoffSecs = Math.min(Math.pow(2, refreshRetryCount.current) * 2 + 60, 120);
        refreshRetryCount.current += 1;
        scheduleRefresh(backoffSecs);
      }
    }, delay);
  }, []);

  // On mount: restore from cached user + verify session via cookie
  useEffect(() => {
    let cancelled = false;

    // Clean up legacy storage
    sessionStorage.removeItem('gaa_auth');

    const restore = async () => {
      const stored = sessionStorage.getItem(USER_STORAGE_KEY);

      if (stored) {
        try {
          const { user: storedUser, expires_at } = JSON.parse(stored);

          if (expires_at && Date.now() < expires_at) {
            // Cookie should still be valid — use cached user immediately for fast UI
            if (!cancelled) {
              setUserState(storedUser);
              const remainingSecs = Math.floor((expires_at - Date.now()) / 1000);
              scheduleRefresh(remainingSecs);

              // Background verify: ensure cached role/player_id/trial are still accurate
              // (fixes iPad PWA showing stale role after resume)
              fetch(`${API_BASE_URL}/auth/me`, { credentials: 'include' })
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                  if (cancelled || !data) return;
                  const fresh = mapApiUser(data);
                  // Only update if something actually changed
                  if (fresh.role !== storedUser.role ||
                      fresh.player_id !== storedUser.player_id ||
                      fresh.club_id !== storedUser.club_id ||
                      fresh.trial_days_remaining !== storedUser.trial_days_remaining ||
                      fresh.on_paid_plan !== storedUser.on_paid_plan) {
                    setUserState(fresh);
                    persistUser(fresh, remainingSecs);
                  }
                })
                .catch(() => { /* network error — cached data is fine for now */ });
            }
          } else {
            // Access token cookie probably expired — try refresh
            try {
              const resp = await fetch(`${API_BASE_URL}/auth/refresh`, {
                method: 'POST',
                credentials: 'include',
              });
              if (cancelled) return;
              if (resp.ok) {
                refreshRetryCount.current = 0;
                const data = await resp.json();
                // A successful cookie refresh says nothing about whether the
                // CACHED user object is still accurate — role/club_id/
                // onboarding state can all change server-side (e.g. an
                // admin reset). Re-fetch /auth/me for current truth instead
                // of trusting storedUser; only fall back to the cache if
                // /auth/me itself fails (keeps the outage-resilience this
                // branch exists for).
                let freshUser = storedUser;
                try {
                  const meResp = await fetch(`${API_BASE_URL}/auth/me`, { credentials: 'include' });
                  if (cancelled) return;
                  if (meResp.ok) {
                    freshUser = mapApiUser(await meResp.json());
                  }
                } catch {
                  // /auth/me network failure — fall back to cached user below
                }
                setUserState(freshUser);
                scheduleRefresh(data.expires_in || 3600);
                persistUser(freshUser, data.expires_in || 3600);
              } else if (resp.status === 401 || resp.status === 403) {
                // Genuine auth rejection — clear session
                setUserState(null);
                sessionStorage.removeItem(USER_STORAGE_KEY);
              } else {
                // Server error during outage — restore from cache and retry shortly
                if (!cancelled) {
                  setUserState(storedUser);
                  scheduleRefresh(62); // retry in ~2s
                }
              }
            } catch {
              // Network error during outage — restore from cache and retry shortly
              if (!cancelled) {
                setUserState(storedUser);
                scheduleRefresh(62); // retry in ~2s
              }
            }
          }
        } catch {
          sessionStorage.removeItem(USER_STORAGE_KEY);
        }
      } else {
        // No cached user — check if httpOnly cookie session exists
        let restored = false;
        try {
          const resp = await fetch(`${API_BASE_URL}/auth/me`, {
            credentials: 'include',
          });
          if (cancelled) return;
          if (resp.ok) {
            const userData = await resp.json();
            const authUser = mapApiUser(userData);
            setUserState(authUser);
            persistUser(authUser, 3600);
            scheduleRefresh(3600);
            restored = true;
          }
        } catch {
          // /auth/me failed — will try refresh below
        }
        // If /auth/me failed (expired access token), try refresh — the refresh
        // token cookie may still be valid (e.g., iPad PWA resumed after background)
        if (!restored && !cancelled) {
          try {
            const refreshResp = await fetch(`${API_BASE_URL}/auth/refresh`, {
              method: 'POST',
              credentials: 'include',
            });
            if (cancelled) return;
            if (refreshResp.ok) {
              const data = await refreshResp.json();
              // Now fetch fresh user data with the new access token
              const meResp = await fetch(`${API_BASE_URL}/auth/me`, {
                credentials: 'include',
              });
              if (cancelled) return;
              if (meResp.ok) {
                const userData = await meResp.json();
                const authUser = mapApiUser(userData);
                setUserState(authUser);
                persistUser(authUser, data.expires_in || 3600);
                scheduleRefresh(data.expires_in || 3600);
              }
            }
          } catch {
            // No valid session at all — user will need to log in
          }
        }
      }

      if (!cancelled) {
        setIsLoading(false);
      }
    };

    restore();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (signUp?: boolean) => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = crypto.randomUUID();

    // Store PKCE verifier and OAuth state for the callback
    sessionStorage.setItem('pkce_verifier', verifier);
    sessionStorage.setItem('oauth_state', state);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: COGNITO_CLIENT_ID,
      redirect_uri: COGNITO_REDIRECT_URI,
      scope: 'openid email',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });

    // Cognito hosted UI: /signup goes directly to create account page
    const endpoint = signUp ? 'signup' : 'oauth2/authorize';
    window.location.href = `${COGNITO_DOMAIN}/${endpoint}?${params.toString()}`;
  }, []);

  const exchangeCode = useCallback(async (code: string, inviteCode?: string) => {
    const verifier = sessionStorage.getItem('pkce_verifier');
    sessionStorage.removeItem('pkce_verifier');

    if (!verifier) {
      throw new Error('Missing PKCE verifier — session may have expired. Please log in again.');
    }

    const body: Record<string, string> = {
      code,
      redirect_uri: COGNITO_REDIRECT_URI,
      code_verifier: verifier,
    };
    if (inviteCode) {
      body.invite_code = inviteCode;
    }

    const resp = await fetch(`${API_BASE_URL}/auth/token`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Token exchange failed');
    }

    const data = await resp.json();
    const authUser = mapApiUser(data.user);

    setUserState(authUser);
    scheduleRefresh(data.expires_in || 3600);
    persistUser(authUser, data.expires_in || 3600);
  }, [scheduleRefresh, persistUser]);

  const logout = useCallback(async () => {
    // Clear local state immediately
    setUserState(null);
    sessionStorage.removeItem(USER_STORAGE_KEY);
    sessionStorage.removeItem(PREVIEW_ID_KEY);
    sessionStorage.removeItem(PREVIEW_NAME_KEY);
    setPreviewPlayer(null);
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);

    // MUST await backend logout so httpOnly cookies are cleared before redirect.
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Continue with redirect even if revoke fails
    }

    // Redirect to Cognito logout to end the hosted UI session,
    // otherwise the next login auto-completes without prompting credentials.
    const logoutUrl = new URL(`${COGNITO_DOMAIN}/logout`);
    logoutUrl.searchParams.set('client_id', COGNITO_CLIENT_ID);
    logoutUrl.searchParams.set('response_type', 'code');
    logoutUrl.searchParams.set('logout_uri', window.location.origin + '/login');
    window.location.href = logoutUrl.toString();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoading,
        login,
        logout,
        exchangeCode,
        setUser,
        previewPlayer,
        startPreview,
        exitPreview,
        isViewer,
        canEdit,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
