import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Club } from '../types';
import { API_BASE } from '../services/api';

interface ClubContextType {
  club: Club | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  logoUrl: string | null;
}

const ClubContext = createContext<ClubContextType>({
  club: null,
  loading: true,
  error: null,
  refetch: () => {},
  logoUrl: null,
});

export function ClubProvider({ children }: { children: React.ReactNode }) {
  const [club, setClub] = useState<Club | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    fetchClub();
  }, []);

  // Logo URL: if club has a logo_url, use the serve endpoint (handles R2 presigned URLs)
  const logoUrl = club?.logo_url ? `${API_BASE}/club/logo/serve` : null;

  return (
    <ClubContext.Provider value={{ club, loading, error, refetch: fetchClub, logoUrl }}>
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
