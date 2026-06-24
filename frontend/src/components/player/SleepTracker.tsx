import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ReferenceLine,
} from 'recharts';
import { Moon, Star } from 'lucide-react';
import { playerPortalAPI } from '../../services/playerPortalApi';
import type { SleepLogEntry } from '../../services/playerPortalApi';

const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'rgba(15,15,30,0.95)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
  },
  labelStyle: { color: 'rgba(255,255,255,0.7)' },
};

// Format a YYYY-MM-DD date into a short day label e.g. "Mon 23"
function shortDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.toLocaleDateString('en-IE', { weekday: 'short' });
  return `${day} ${d.getDate()}`;
}

// Returns today's date as YYYY-MM-DD in local time
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function barFill(hours: number): string {
  if (hours >= 7) return '#10b981'; // emerald
  if (hours >= 6) return '#f59e0b'; // amber
  return '#ef4444'; // red
}

export default function SleepTracker() {
  const queryClient = useQueryClient();

  // History fetch (14 days)
  const { data: historyData } = useQuery({
    queryKey: ['sleep-history'],
    queryFn: () => playerPortalAPI.getSleepHistory(14),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const entries: SleepLogEntry[] = historyData?.entries ?? [];

  // Determine if today already has an entry
  const today = todayStr();
  const todayEntry = entries.find((e) => e.date === today) ?? null;

  // Form state
  const [hours, setHours] = useState(todayEntry?.hours_slept ?? 7.5);
  const [quality, setQuality] = useState<number | null>(todayEntry?.quality ?? null);
  const [saved, setSaved] = useState(false);

  // Keep form in sync if today's entry loads after mount
  useEffect(() => {
    if (todayEntry) {
      setHours(todayEntry.hours_slept);
      setQuality(todayEntry.quality ?? null);
    }
  }, [todayEntry]);

  const mutation = useMutation({
    mutationFn: (payload: { hours_slept: number; quality?: number }) =>
      playerPortalAPI.logSleep(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sleep-history'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  function handleLog() {
    mutation.mutate({
      hours_slept: hours,
      ...(quality != null ? { quality } : {}),
    });
  }

  function nudgeHours(delta: number) {
    setHours((h) => Math.min(12, Math.max(3, +(h + delta).toFixed(1))));
  }

  // Chart data: last 14 days sorted oldest → newest
  const chartData = [...entries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({
      label: shortDayLabel(e.date),
      hours: e.hours_slept,
    }));

  // Stats
  const last7 = entries
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);
  const avg7 = last7.length > 0
    ? (last7.reduce((s, e) => s + e.hours_slept, 0) / last7.length).toFixed(1)
    : null;
  const nightsGood = entries.filter((e) => e.hours_slept >= 7).length;

  const isUpdate = !!todayEntry;

  return (
    <div
      className="rounded-xl p-4 space-y-5"
      style={{
        background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.04))',
        border: '1px solid rgba(99,102,241,0.18)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Moon size={16} className="text-indigo-400" />
        <h3 className="text-sm font-semibold text-white">Sleep Tracker</h3>
      </div>

      {/* --- Log Form --- */}
      <div className="space-y-4">
        <p className="text-[11px] text-white/50">Last Night&apos;s Sleep</p>

        {/* Hours stepper */}
        <div className="flex items-center justify-center gap-5">
          <button
            onClick={() => nudgeHours(-0.5)}
            aria-label="Decrease hours"
            className="w-10 h-10 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center text-white/70 hover:text-white text-lg font-bold transition-colors border border-white/10"
          >
            −
          </button>
          <div className="text-center min-w-[90px]">
            <span className="text-3xl font-bold text-white tabular-nums">{hours.toFixed(1)}</span>
            <span className="text-sm text-white/50 ml-1">hrs</span>
          </div>
          <button
            onClick={() => nudgeHours(0.5)}
            aria-label="Increase hours"
            className="w-10 h-10 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center text-white/70 hover:text-white text-lg font-bold transition-colors border border-white/10"
          >
            +
          </button>
        </div>

        {/* Quality stars */}
        <div className="flex flex-col items-center gap-1.5">
          <p className="text-[10px] text-white/40 uppercase">Quality (optional)</p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => setQuality((prev) => (prev === star ? null : star))}
                aria-label={`${star} star${star > 1 ? 's' : ''}`}
                className="transition-transform hover:scale-110"
              >
                <Star
                  size={22}
                  className={
                    quality != null && star <= quality
                      ? 'text-amber-400'
                      : 'text-white/20'
                  }
                  fill={quality != null && star <= quality ? '#fbbf24' : 'none'}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Log button */}
        <button
          onClick={handleLog}
          disabled={mutation.isPending}
          className={`w-full px-4 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
            saved
              ? 'bg-emerald-600 text-white'
              : mutation.isPending
              ? 'bg-emerald-700/60 text-white/60 cursor-not-allowed'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          }`}
        >
          {saved ? 'Logged! ✓' : mutation.isPending ? 'Saving...' : isUpdate ? 'Update' : 'Log Sleep'}
        </button>

        {mutation.isError && (
          <p className="text-[11px] text-red-400 text-center">
            Failed to save. Please try again.
          </p>
        )}
      </div>

      {/* --- 14-day History Chart --- */}
      <div className="space-y-3">
        <p className="text-[11px] text-white/50">14-Day History</p>

        {chartData.length === 0 ? (
          <p className="text-center text-white/40 text-xs py-6">No sleep data yet</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData} barCategoryGap="20%">
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.35)' }}
                  axisLine={false}
                  tickLine={false}
                  interval={1}
                />
                <YAxis
                  domain={[0, 12]}
                  tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.35)' }}
                  axisLine={false}
                  tickLine={false}
                  width={22}
                />
                <Tooltip
                  {...TOOLTIP_STYLE}
                  formatter={(val: number) => [`${val}h`, 'Sleep']}
                />
                <ReferenceLine
                  y={7}
                  stroke="rgba(255,255,255,0.3)"
                  strokeDasharray="4 4"
                  label={{
                    value: 'Target',
                    fill: 'rgba(255,255,255,0.35)',
                    fontSize: 9,
                    position: 'right',
                  }}
                />
                <Bar dataKey="hours" radius={[3, 3, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={barFill(entry.hours)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Stat pills */}
            <div className="flex gap-2 flex-wrap">
              {avg7 != null && (
                <span className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-white/6 border border-white/10 text-white/60">
                  7-day avg:{' '}
                  <span className="text-white font-semibold">{avg7}h</span>
                </span>
              )}
              <span className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-white/6 border border-white/10 text-white/60">
                Nights &ge;7h:{' '}
                <span className="text-emerald-400 font-semibold">
                  {nightsGood}/{entries.length}
                </span>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
