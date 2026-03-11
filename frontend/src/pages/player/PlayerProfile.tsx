import { useAuth } from '../../contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { playerPortalAPI } from '../../services/playerPortalApi';
import { LogOut, Bell, BellOff, User } from 'lucide-react';
import PlayerHeader from '../../components/PlayerHeader';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

export default function PlayerProfile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => Notification.permission === 'granted'
  );

  const { data: dashboard } = useQuery({
    queryKey: ['player-dashboard'],
    queryFn: playerPortalAPI.getMyDashboard,
  });

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const toggleNotifications = async () => {
    if (!notificationsEnabled) {
      const perm = await Notification.requestPermission();
      setNotificationsEnabled(perm === 'granted');
    } else {
      setNotificationsEnabled(false);
    }
  };

  return (
    <div className="space-y-5 pb-4">
      <PlayerHeader title="Profile" />

      {/* Player Card */}
      <div
        className="rounded-2xl p-5 flex items-center gap-4"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))',
          border: '1px solid rgba(255,255,255,0.10)',
        }}
      >
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center text-2xl font-bold text-white shadow-lg">
          {dashboard?.jersey_number || <User size={28} />}
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">{dashboard?.player_name || user?.name || 'Player'}</h2>
          <p className="text-sm text-white/50 capitalize">{dashboard?.position || 'Player'}</p>
          <p className="text-xs text-white/30 mt-0.5">{user?.email}</p>
        </div>
      </div>

      {/* Stats Summary */}
      {dashboard && (
        <div className="grid grid-cols-3 gap-3">
          <ProfileStat label="Matches" value={dashboard.season_stats.matches_played} />
          <ProfileStat label="Score" value={dashboard.season_stats.total_score} />
          <ProfileStat label="Accuracy" value={dashboard.season_stats.accuracy_pct != null ? `${dashboard.season_stats.accuracy_pct}%` : '—'} />
        </div>
      )}

      {/* Settings */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <button
          onClick={toggleNotifications}
          className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            {notificationsEnabled ? <Bell size={18} className="text-emerald-400" /> : <BellOff size={18} className="text-white/40" />}
            <span className="text-sm text-white/80">Push Notifications</span>
          </div>
          <div className={`w-10 h-6 rounded-full flex items-center transition-colors ${notificationsEnabled ? 'bg-emerald-500 justify-end' : 'bg-white/15 justify-start'}`}>
            <div className="w-5 h-5 rounded-full bg-white mx-0.5 shadow" />
          </div>
        </button>

        <div className="h-px bg-white/5" />

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-500/5 transition-colors"
        >
          <LogOut size={18} className="text-red-400" />
          <span className="text-sm text-red-400">Logout</span>
        </button>
      </div>

      {/* App Info */}
      <div className="text-center pt-4">
        <p className="text-[11px] text-white/20">OneStat Analytics v1.0</p>
        <p className="text-[11px] text-white/15 mt-0.5">Player Portal</p>
      </div>
    </div>
  );
}

function ProfileStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      className="rounded-xl px-3 py-3 text-center"
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="text-[10px] text-white/40 uppercase">{label}</div>
      <div className="text-base font-bold text-white mt-0.5">{value}</div>
    </div>
  );
}
