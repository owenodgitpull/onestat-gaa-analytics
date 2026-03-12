import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import type { WeeklyBrief } from '../../services/api';

export default function WeeklyBriefCard() {
  const [brief, setBrief] = useState<WeeklyBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['form_watch']));

  useEffect(() => {
    fetchBrief(false);
  }, []);

  async function fetchBrief(forceRefresh: boolean) {
    try {
      if (forceRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      const result = await api.ai.getWeeklyBrief(forceRefresh);
      if (result.success && result.brief) {
        setBrief(result.brief);
      } else if (result.error) {
        setError(result.error);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load weekly brief');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function toggleSection(key: string) {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6 animate-pulse">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3 mb-2" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
      </div>
    );
  }

  if (error || !brief) {
    return null; // Graceful degradation - just don't show the card
  }

  const sections = [
    {
      key: 'form_watch',
      label: 'Form Watch',
      content: brief.form_watch ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">{brief.form_watch.summary}</p>
          {brief.form_watch.hot_players?.length > 0 && (
            <div>
              <span className="text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wide">In Form</span>
              {brief.form_watch.hot_players.map((p, i) => (
                <p key={i} className="text-sm text-gray-600 dark:text-gray-400 ml-2">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{p.name}</span> — {p.detail}
                </p>
              ))}
            </div>
          )}
          {brief.form_watch.cold_players?.length > 0 && (
            <div>
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide">Watch List</span>
              {brief.form_watch.cold_players.map((p, i) => (
                <p key={i} className="text-sm text-gray-600 dark:text-gray-400 ml-2">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{p.name}</span> — {p.detail}
                </p>
              ))}
            </div>
          )}
        </div>
      ) : null,
    },
    {
      key: 'physical_state',
      label: 'Physical State',
      content: brief.physical_state ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">{brief.physical_state.summary}</p>
          {brief.physical_state.workload_flags?.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-red-600 dark:text-red-400 uppercase tracking-wide">Workload Flags</span>
              {brief.physical_state.workload_flags.map((f, i) => (
                <p key={i} className="text-sm text-gray-600 dark:text-gray-400 ml-2">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{f.player}</span> — ACWR {f.acwr} ({f.risk})
                </p>
              ))}
            </div>
          )}
          {brief.physical_state.recovery_notes && (
            <p className="text-sm text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 p-2 rounded">
              {brief.physical_state.recovery_notes}
            </p>
          )}
        </div>
      ) : null,
    },
    {
      key: 'tactical_insight',
      label: 'Tactical Insight',
      content: brief.tactical_insight ? (
        <p className="text-sm text-gray-700 dark:text-gray-300">{brief.tactical_insight}</p>
      ) : null,
    },
    {
      key: 'upcoming_prep',
      label: 'Upcoming Match',
      content: brief.upcoming_prep ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
            vs {brief.upcoming_prep.opponent} — {brief.upcoming_prep.date}
          </p>
          {brief.upcoming_prep.key_considerations?.length > 0 && (
            <ul className="list-disc list-inside text-sm text-gray-600 dark:text-gray-400 space-y-1">
              {brief.upcoming_prep.key_considerations.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null,
    },
  ].filter(s => s.content !== null);

  return (
    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-xl border border-indigo-200 dark:border-indigo-800 p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Weekly Brief</h3>
          {brief.headline && (
            <p className="text-sm text-indigo-700 dark:text-indigo-300 font-medium mt-0.5">{brief.headline}</p>
          )}
        </div>
        <button
          onClick={() => fetchBrief(true)}
          disabled={refreshing}
          className="text-xs px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="space-y-2">
        {sections.map(section => (
          <div key={section.key} className="bg-white/70 dark:bg-gray-800/70 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection(section.key)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-white/90 dark:hover:bg-gray-800/90 transition-colors"
            >
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {section.label}
              </span>
              <svg
                className={`w-4 h-4 text-gray-500 transition-transform ${expandedSections.has(section.key) ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedSections.has(section.key) && (
              <div className="px-4 pb-3">
                {section.content}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
