import { useState } from 'react';
import { X, Send, UserPlus } from 'lucide-react';
import { fetchAPI } from '../services/api';

interface InvitePlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  player: { id: string; name: string } | null;
}

export default function InvitePlayerModal({ isOpen, onClose, player }: InvitePlayerModalProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !player) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    setError(null);

    try {
      await fetchAPI('/auth/invite-player', {
        method: 'POST',
        body: JSON.stringify({
          player_id: player.id,
          email: email.trim(),
        }),
      });
      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
        setEmail('');
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to send invite');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative w-full max-w-md rounded-2xl p-6"
        style={{
          background: 'linear-gradient(135deg, rgba(30, 30, 60, 0.98), rgba(20, 20, 45, 0.98))',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
        }}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-white/40 hover:text-white">
          <X size={20} />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
            <UserPlus size={20} className="text-indigo-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Invite to App</h2>
            <p className="text-sm text-white/50">{player.name}</p>
          </div>
        </div>

        {success ? (
          <div className="text-center py-6">
            <div className="text-emerald-400 text-lg font-semibold mb-1">Invite Sent!</div>
            <p className="text-white/50 text-sm">{player.name} can now log in with {email}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-white/60 mb-1">Player's Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="player@email.com"
                required
                className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:border-indigo-500/50 focus:outline-none text-sm"
              />
              <p className="text-[11px] text-white/30 mt-1">
                They'll use this email to sign in via the login page.
              </p>
            </div>

            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <Send size={16} />
                  Send Invite
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
