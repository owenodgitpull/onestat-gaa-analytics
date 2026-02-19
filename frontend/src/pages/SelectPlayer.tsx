import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Check, UserCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

interface RosterPlayer {
  id: string;
  name: string;
  jersey_number: number | null;
  position: string | null;
  is_claimed: boolean;
}

export default function SelectPlayer() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [players, setPlayers] = useState<RosterPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If user already has a player_id, redirect to portal
  useEffect(() => {
    if (user?.player_id) {
      navigate('/player', { replace: true });
    }
  }, [user, navigate]);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${API_BASE_URL}/auth/roster`, {
          credentials: 'include',
        });
        if (!resp.ok) throw new Error('Failed to load roster');
        const data = await resp.json();
        setPlayers(data.players);
      } catch (err: any) {
        setError(err.message || 'Could not load player list');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!search) return players;
    const q = search.toLowerCase();
    return players.filter(
      p => p.name.toLowerCase().includes(q) || (p.jersey_number?.toString() || '').includes(q)
    );
  }, [players, search]);

  const handleConfirm = async () => {
    if (!selected) return;
    setConfirming(true);
    setError(null);

    try {
      const resp = await fetch(`${API_BASE_URL}/auth/select-player`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: selected }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to select player');
      }

      const updatedUser = await resp.json();

      // Update auth context with new player_id
      if (user) {
        setUser({ ...user, player_id: updatedUser.player_id });
      }

      navigate('/player', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const selectedPlayer = players.find(p => p.id === selected);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div
        className="w-full max-w-md rounded-2xl p-6"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.05))',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <div className="text-center mb-6">
          <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center">
            <UserCheck size={28} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">Select Your Profile</h1>
          <p className="text-white/60 text-sm mt-1">
            Pick your name from the squad list
          </p>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
          <input
            type="text"
            placeholder="Search by name or number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
          />
        </div>

        {/* Player list */}
        <div className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1">
          {filtered.map(p => {
            const isClaimed = p.is_claimed;
            const isSelected = selected === p.id;

            return (
              <button
                key={p.id}
                disabled={isClaimed}
                onClick={() => setSelected(isSelected ? null : p.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                  isClaimed
                    ? 'opacity-40 cursor-not-allowed'
                    : isSelected
                    ? 'bg-emerald-500/20 border border-emerald-500/40'
                    : 'bg-white/5 hover:bg-white/10 border border-transparent'
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold text-white ${
                  isSelected ? 'bg-emerald-600' : 'bg-white/10'
                }`}>
                  {p.jersey_number ?? '-'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white text-sm truncate">{p.name}</div>
                  <div className="text-xs text-white/50 capitalize">
                    {(p.position || 'unknown').replace(/_/g, ' ')}
                  </div>
                </div>
                {isClaimed && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/10 text-white/50">
                    Registered
                  </span>
                )}
                {isSelected && (
                  <Check size={18} className="text-emerald-400 shrink-0" />
                )}
              </button>
            );
          })}

          {filtered.length === 0 && (
            <div className="text-center py-8 text-white/40 text-sm">
              {search ? 'No players match your search' : 'No players available'}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-400 mt-3 text-center">{error}</p>
        )}

        {/* Confirm button */}
        <button
          onClick={handleConfirm}
          disabled={!selected || confirming}
          className="w-full mt-4 py-3 rounded-xl text-white font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: selected
              ? 'linear-gradient(135deg, rgba(0,230,118,0.25), rgba(0,176,255,0.2))'
              : 'rgba(255,255,255,0.05)',
            border: selected ? '1px solid rgba(0,176,255,0.35)' : '1px solid rgba(255,255,255,0.1)',
          }}
        >
          {confirming ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
          ) : selected && selectedPlayer ? (
            `I'm ${selectedPlayer.name}`
          ) : (
            'Select your name above'
          )}
        </button>
      </div>
    </div>
  );
}
