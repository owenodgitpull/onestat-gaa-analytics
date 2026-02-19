import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { generateCodeVerifier, generateCodeChallenge } from '../lib/pkce';

const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN;
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
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (signUp?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  exchangeCode: (code: string, inviteCode?: string) => Promise<void>;
  setUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
  exchangeCode: async () => {},
  setUser: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const isAuthenticated = !!user;

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

  // Schedule cookie refresh before expiry
  const scheduleRefresh = useCallback((expiresIn: number) => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    // Refresh 60 seconds before expiry
    const delay = Math.max((expiresIn - 60) * 1000, 10000);
    refreshTimeoutRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (resp.ok) {
          const data = await resp.json();
          scheduleRefresh(data.expires_in || 3600);
          // Update expiry in sessionStorage
          const stored = sessionStorage.getItem(USER_STORAGE_KEY);
          if (stored) {
            const parsed = JSON.parse(stored);
            parsed.expires_at = Date.now() + (data.expires_in || 3600) * 1000;
            sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(parsed));
          }
        } else {
          // Refresh failed — force re-login
          setUserState(null);
          sessionStorage.removeItem(USER_STORAGE_KEY);
        }
      } catch {
        // Network error — will retry on next interaction
      }
    }, delay);
  }, []);

  // On mount: restore from cached user + verify session via cookie
  useEffect(() => {
    const stored = sessionStorage.getItem(USER_STORAGE_KEY);

    // Clean up legacy storage (pre-httpOnly cookie migration)
    sessionStorage.removeItem('gaa_auth');

    if (stored) {
      try {
        const { user: storedUser, expires_at } = JSON.parse(stored);
        setUserState(storedUser);

        if (expires_at && Date.now() < expires_at) {
          // Cookie should still be valid — schedule next refresh
          const remainingSecs = Math.floor((expires_at - Date.now()) / 1000);
          scheduleRefresh(remainingSecs);
        } else {
          // Access token cookie probably expired — try refresh
          (async () => {
            try {
              const resp = await fetch(`${API_BASE_URL}/auth/refresh`, {
                method: 'POST',
                credentials: 'include',
              });
              if (resp.ok) {
                const data = await resp.json();
                scheduleRefresh(data.expires_in || 3600);
                persistUser(storedUser, data.expires_in || 3600);
              } else {
                setUserState(null);
                sessionStorage.removeItem(USER_STORAGE_KEY);
              }
            } catch {
              setUserState(null);
              sessionStorage.removeItem(USER_STORAGE_KEY);
            }
          })();
        }
      } catch {
        sessionStorage.removeItem(USER_STORAGE_KEY);
      }
    } else {
      // No cached user — check if httpOnly cookie session exists
      (async () => {
        try {
          const resp = await fetch(`${API_BASE_URL}/auth/me`, {
            credentials: 'include',
          });
          if (resp.ok) {
            const userData = await resp.json();
            const authUser: AuthUser = {
              id: userData.id,
              email: userData.email,
              name: userData.name,
              club_id: userData.club_id,
              role: userData.role,
              player_id: userData.player_id || null,
              is_active: userData.is_active,
            };
            setUserState(authUser);
            persistUser(authUser, 3600);
            scheduleRefresh(3600);
          }
        } catch {
          // No session — that's fine
        }
      })();
    }

    setIsLoading(false);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

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
      throw new Error('Missing PKCE verifier');
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
    const authUser: AuthUser = {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name,
      club_id: data.user.club_id,
      role: data.user.role,
      player_id: data.user.player_id || null,
      is_active: data.user.is_active,
    };

    setUserState(authUser);
    scheduleRefresh(data.expires_in || 3600);
    persistUser(authUser, data.expires_in || 3600);
  }, [scheduleRefresh, persistUser]);

  const logout = useCallback(() => {
    // Fire backend revoke without waiting — don't block the redirect
    fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});

    // Clear local state immediately
    setUserState(null);
    sessionStorage.removeItem(USER_STORAGE_KEY);
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);

    // Redirect to Cognito logout to end the hosted UI session,
    // otherwise the next login auto-completes without prompting credentials.
    const logoutUrl = new URL(`${COGNITO_DOMAIN}/logout`);
    logoutUrl.searchParams.set('client_id', COGNITO_CLIENT_ID);
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
