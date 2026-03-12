import { useState, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '../../services/api';
import type { WeeklyBrief } from '../../services/api';

export default function WeeklyBriefCard() {
  const [brief, setBrief] = useState<WeeklyBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchBrief();
  }, []);

  async function fetchBrief() {
    try {
      setLoading(true);
      setError(null);
      const result = await api.ai.getWeeklyBrief(false);
      if (result.success && result.brief) {
        setBrief(result.brief);
      } else if (result.error) {
        setError(result.error);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load weekly brief');
    } finally {
      setLoading(false);
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

  // Loading state with message
  if (loading) {
    return (
      <div className="glass-card px-5 py-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="relative flex-shrink-0">
            <Sparkles size={18} className="text-indigo-400 animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-semibold text-white/90">Weekly Brief</span>
            <span className="text-xs text-white/40 ml-2">Season AI Agent is analyzing the latest data...</span>
          </div>
          <div className="w-4 h-4 border-2 border-indigo-400/40 border-t-indigo-400 rounded-full animate-spin flex-shrink-0" />
        </div>
      </div>
    );
  }

  if (error || !brief) {
    return null;
  }

  const sections = [
    {
      key: 'form_watch',
      label: 'Form Watch',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      ),
      content: brief.form_watch ? (
        <div className="space-y-3">
          <p className="text-sm text-white/70">{brief.form_watch.summary}</p>
          {brief.form_watch.hot_players?.length > 0 && (
            <div>
              <span className="text-xs font-medium text-green-400 uppercase tracking-wide">In Form</span>
              {brief.form_watch.hot_players.map((p, i) => (
                <p key={i} className="text-sm text-white/50 ml-2">
                  <span className="font-medium text-white/90">{p.name}</span> — {p.detail}
                </p>
              ))}
            </div>
          )}
          {brief.form_watch.cold_players?.length > 0 && (
            <div>
              <span className="text-xs font-medium text-amber-400 uppercase tracking-wide">Watch List</span>
              {brief.form_watch.cold_players.map((p, i) => (
                <p key={i} className="text-sm text-white/50 ml-2">
                  <span className="font-medium text-white/90">{p.name}</span> — {p.detail}
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
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
        </svg>
      ),
      content: brief.physical_state ? (
        <div className="space-y-3">
          <p className="text-sm text-white/70">{brief.physical_state.summary}</p>
          {brief.physical_state.workload_flags?.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-red-400 uppercase tracking-wide">Workload Flags</span>
              {brief.physical_state.workload_flags.map((f, i) => (
                <p key={i} className="text-sm text-white/50 ml-2">
                  <span className="font-medium text-white/90">{f.player}</span> — ACWR {f.acwr} ({f.risk})
                </p>
              ))}
            </div>
          )}
          {brief.physical_state.recovery_notes && (
            <p className="text-sm text-blue-300 bg-blue-500/10 border border-blue-500/20 p-2 rounded-lg">
              {brief.physical_state.recovery_notes}
            </p>
          )}
        </div>
      ) : null,
    },
    {
      key: 'tactical_insight',
      label: 'Tactical Insight',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      ),
      content: brief.tactical_insight ? (
        <p className="text-sm text-white/70">{brief.tactical_insight}</p>
      ) : null,
    },
    {
      key: 'upcoming_prep',
      label: 'Upcoming Match',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
      content: brief.upcoming_prep ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-white/90">
            vs {brief.upcoming_prep.opponent} — {brief.upcoming_prep.date}
          </p>
          {brief.upcoming_prep.key_considerations?.length > 0 && (
            <ul className="list-disc list-inside text-sm text-white/50 space-y-1">
              {brief.upcoming_prep.key_considerations.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null,
    },
  ].filter(s => s.content !== null);

  const insightCount = sections.length;

  // Collapsed state: slim glass bar with badge
  if (!expanded) {
    return (
      <button
        onClick={() => {
          setExpanded(true);
          if (expandedSections.size === 0) setExpandedSections(new Set(['form_watch']));
        }}
        className="glass-card w-full px-5 py-3.5 mb-6 flex items-center gap-3 hover:border-white/20 transition-all group cursor-pointer"
      >
        <div className="relative flex-shrink-0">
          <Sparkles size={18} className="text-indigo-400" />
          {insightCount > 0 && (
            <span className="absolute -top-1.5 -right-2 bg-indigo-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {insightCount}
            </span>
          )}
        </div>

        <div className="flex-1 text-left min-w-0 overflow-hidden">
          <span className="text-sm font-semibold text-white/90">Weekly Brief</span>
          {brief.headline && (
            <span className="text-sm text-white/40 ml-2 hidden sm:inline">
              — {brief.headline}
            </span>
          )}
        </div>

        <svg
          className="w-4 h-4 text-white/30 group-hover:text-white/60 transition-colors flex-shrink-0"
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    );
  }

  // Expanded state: full glass card with sections
  return (
    <div className="glass-card p-3 sm:p-5 mb-6 overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setExpanded(false)}
          className="flex items-center gap-2.5 group"
        >
          <svg
            className="w-4 h-4 text-white/30 group-hover:text-white/60 rotate-180 transition-all"
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          <Sparkles size={18} className="text-indigo-400" />
          <h3 className="text-base font-semibold text-white/90">Weekly Brief</h3>
          {brief.headline && (
            <span className="text-sm text-white/40 font-medium hidden sm:inline">
              — {brief.headline}
            </span>
          )}
        </button>
        {/* Brief auto-refreshes when data changes */}
      </div>

      <div className="space-y-1.5">
        {sections.map(section => (
          <div key={section.key} className="rounded-xl overflow-hidden bg-white/[0.04] border border-white/[0.06]">
            <button
              onClick={() => toggleSection(section.key)}
              className="w-full flex items-center justify-between px-3 sm:px-4 py-2.5 text-left hover:bg-white/[0.06] transition-colors"
            >
              <div className="flex items-center gap-2.5 text-white/40">
                {section.icon}
                <span className="text-sm font-medium text-white/80">
                  {section.label}
                </span>
              </div>
              <svg
                className={`w-4 h-4 text-white/30 transition-transform ${expandedSections.has(section.key) ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedSections.has(section.key) && (
              <div className="px-3 sm:px-4 pb-3 border-t border-white/[0.06]">
                <div className="pt-3">
                  {section.content}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
