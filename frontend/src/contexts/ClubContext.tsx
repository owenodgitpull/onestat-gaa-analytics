import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Club, ClubMembership } from '../types';
import { API_BASE, organizationsAPI } from '../services/api';
import { useAuth } from './AuthContext';
import { useQueryClient } from '@tanstack/react-query';

interface ClubContextType {
  club: Club | null;
  clubs: ClubMembership[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  logoUrl: string | null;
  switchClub: (clubId: string) => Promise<void>;
}

const ClubContext = createContext<ClubContextType>({
  club: null,
  clubs: [],
  loading: true,
  error: null,
  refetch: () => {},
  logoUrl: null,
  switchClub: async () => {},
});

export function ClubProvider({ children }: { children: React.ReactNode }) {
  const [club, setClub] = useState<Club | null>(null);
  const [clubs, setClubs] = useState<ClubMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, setUser } = useAuth();
  const queryClient = useQueryClient();

  const fetchClub = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/club/`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch club');
      const data = await res.json();
      setClub(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchClubs = async () => {
    try {
      const list = await organizationsAPI.getMyClubs();
      setClubs(list);
    } catch {
      // Non-critical — single-team users may not have memberships yet
      setClubs([]);
    }
  };

  useEffect(() => {
    fetchClub();
    fetchClubs();
  }, []);

  const switchClub = useCallback(async (clubId: string) => {
    try {
      const result = await organizationsAPI.switchClub(clubId);
      // Update auth context with new club/role/player
      if (user) {
        setUser({
          ...user,
          club_id: result.club_id,
          role: result.role,
          player_id: result.player_id,
        });
      }
      // Clear all cached data from previous club
      queryClient.clear();
      // Refetch club data and memberships for new club
      await fetchClub();
      await fetchClubs();
    } catch (err: any) {
      throw err;
    }
  }, [user, setUser, queryClient]);

  // Logo URL: if club has a logo_url, use the serve endpoint (handles R2 presigned URLs)
  const logoUrl = club?.logo_url ? `${API_BASE}/club/logo/serve` : null;

  return (
    <ClubContext.Provider value={{ club, clubs, loading, error, refetch: fetchClub, logoUrl, switchClub }}>
      {children}
    </ClubContext.Provider>
  );
}

export function useClub() {
  return useContext(ClubContext);
}

/** Convenience: returns the short display name or falls back to full name */
export function useClubName(): string {
  const { club } = useClub();
  return club?.short_name || club?.name || 'Team';
}
