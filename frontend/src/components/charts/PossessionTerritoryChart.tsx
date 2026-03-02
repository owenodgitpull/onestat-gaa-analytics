import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Target } from 'lucide-react'
import { possessionAPI } from '@/services/api'

interface PossessionTerritoryChartProps {
  stats: any
  events: any[]
  matchId: string
  opponent: string
  insight?: string
  insightLoading?: boolean
  /** Poll interval in ms for live data (0 = no polling) */
  pollInterval?: number
}

export default function PossessionTerritoryChart({
  stats,
  events,
  matchId,
  opponent,
  insight,
  insightLoading = false,
  pollInterval = 0,
}: PossessionTerritoryChartProps) {
  const [selectedTeam, setSelectedTeam] = useState<'own' | 'opponent'>('own')
  const [selectedHalf, setSelectedHalf] = useState<'all' | '1st' | '2nd'>('all')

  const { data: possessionEvents } = useQuery({
    queryKey: ['possession-events', matchId],
    queryFn: () => possessionAPI.getByMatch(matchId),
    enabled: !!matchId,
    refetchInterval: pollInterval || false,
  })

  const territory = useMemo(() => {
    const zones = {
      own: { defensive: 0, midfield: 0, attacking: 0 },
      opponent: { defensive: 0, midfield: 0, attacking: 0 }
    }

    const usePossession = possessionEvents && possessionEvents.length > 0
    const sourceData = usePossession ? possessionEvents : events

    sourceData.forEach((e: any) => {
      const px = e.pitch_x
      if (px === null || px === undefined) return

      const minute = e.minute || 0
      if (selectedHalf === '1st' && minute > 35) return
      if (selectedHalf === '2nd' && minute <= 35) return

      const team = e.team || (e.is_home_team ? 'own' : 'opponent')
      if (team !== 'own' && team !== 'opponent') return

      const weight = usePossession ? (e.duration_seconds || 1) : 1

      if (px < 35) {
        zones[team as keyof typeof zones].defensive += weight
      } else if (px < 65) {
        zones[team as keyof typeof zones].midfield += weight
      } else {
        zones[team as keyof typeof zones].attacking += weight
      }
    })

    const ownTotal = zones.own.defensive + zones.own.midfield + zones.own.attacking
    const oppTotal = zones.opponent.defensive + zones.opponent.midfield + zones.opponent.attacking

    return {
      own: {
        defensive: ownTotal > 0 ? Math.round((zones.own.defensive / ownTotal) * 100) : 0,
        midfield: ownTotal > 0 ? Math.round((zones.own.midfield / ownTotal) * 100) : 0,
        attacking: ownTotal > 0 ? Math.round((zones.own.attacking / ownTotal) * 100) : 0
      },
      opponent: {
        defensive: oppTotal > 0 ? Math.round((zones.opponent.defensive / oppTotal) * 100) : 0,
        midfield: oppTotal > 0 ? Math.round((zones.opponent.midfield / oppTotal) * 100) : 0,
        attacking: oppTotal > 0 ? Math.round((zones.opponent.attacking / oppTotal) * 100) : 0
      }
    }
  }, [possessionEvents, events, selectedHalf])

  const ownPosPct = Math.round(stats?.team_possession_percentage || 50)
  const possession = { own: ownPosPct, opponent: 100 - ownPosPct }
  const currentTerritory = territory[selectedTeam]
  const teamColor = selectedTeam === 'own' ? '#84cc16' : '#f97316'

  return (
    <div className="glass-card p-4">
      <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
        <Target size={20} />
        Territory
      </h3>

      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1">
          <button
            onClick={() => setSelectedTeam('own')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              selectedTeam === 'own' ? 'bg-lime-500 text-black' : 'bg-white/10 text-white/60 hover:bg-white/20'
            }`}
          >
            <div className="w-2 h-2 rounded-full bg-current" /> DUN
          </button>
          <button
            onClick={() => setSelectedTeam('opponent')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              selectedTeam === 'opponent' ? 'bg-orange-500 text-black' : 'bg-white/10 text-white/60 hover:bg-white/20'
            }`}
          >
            <div className="w-2 h-2 rounded-full bg-current" /> {opponent.substring(0, 3).toUpperCase()}
          </button>
        </div>

        <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
          {(['all', '1st', '2nd'] as const).map((half) => (
            <button
              key={half}
              onClick={() => setSelectedHalf(half)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                selectedHalf === half ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/80'
              }`}
            >
              {half === 'all' ? 'All' : half}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <svg viewBox="0 0 300 180" className="w-full h-auto">
          <rect x="0" y="0" width="300" height="180" fill="#1a1a2e" rx="8" />
          <rect x="10" y="10" width="280" height="160" fill="none" stroke="#334155" strokeWidth="2" rx="4" />
          <line x1="103" y1="10" x2="103" y2="170" stroke="#334155" strokeWidth="1" strokeDasharray="4,4" />
          <line x1="197" y1="10" x2="197" y2="170" stroke="#334155" strokeWidth="1" strokeDasharray="4,4" />
          <rect x="10" y="55" width="25" height="70" fill="none" stroke="#334155" strokeWidth="1.5" />
          <rect x="10" y="70" width="12" height="40" fill="none" stroke="#334155" strokeWidth="1" />
          <rect x="265" y="55" width="25" height="70" fill="none" stroke="#334155" strokeWidth="1.5" />
          <rect x="278" y="70" width="12" height="40" fill="none" stroke="#334155" strokeWidth="1" />
          <line x1="150" y1="10" x2="150" y2="170" stroke="#334155" strokeWidth="1.5" />
          <circle cx="150" cy="90" r="20" fill="none" stroke="#334155" strokeWidth="1.5" />
          <line x1="60" y1="10" x2="60" y2="170" stroke="#334155" strokeWidth="1" strokeDasharray="2,4" />
          <line x1="240" y1="10" x2="240" y2="170" stroke="#334155" strokeWidth="1" strokeDasharray="2,4" />
          <rect x="10" y="10" width="93" height="160" fill={teamColor} fillOpacity="0.1" />
          <rect x="103" y="10" width="94" height="160" fill={teamColor} fillOpacity="0.15" />
          <rect x="197" y="10" width="93" height="160" fill={teamColor} fillOpacity="0.1" />
        </svg>

        <div className="absolute inset-0 flex items-center justify-around px-6">
          <div className="flex flex-col items-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-black text-lg shadow-lg" style={{ backgroundColor: teamColor }}>
              {currentTerritory.defensive}%
            </div>
            <span className="text-xs text-white/50 mt-2 font-medium">DEF</span>
          </div>
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center font-bold text-black text-xl shadow-lg" style={{ backgroundColor: teamColor }}>
              {currentTerritory.midfield}%
            </div>
            <span className="text-xs text-white/50 mt-2 font-medium">MID</span>
          </div>
          <div className="flex flex-col items-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-black text-lg shadow-lg" style={{ backgroundColor: teamColor }}>
              {currentTerritory.attacking}%
            </div>
            <span className="text-xs text-white/50 mt-2 font-medium">ATK</span>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-white/10">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-lime-400 font-semibold w-10">{Math.round(possession.own)}%</span>
          <div className="flex-1 h-2 rounded-full overflow-hidden flex bg-white/10">
            <div className="bg-lime-500 transition-all" style={{ width: `${possession.own}%` }} />
            <div className="bg-orange-500 transition-all" style={{ width: `${possession.opponent}%` }} />
          </div>
          <span className="text-orange-400 font-semibold w-10 text-right">{Math.round(possession.opponent)}%</span>
        </div>
        <div className="flex justify-between text-[10px] text-white/40 mt-1 px-10">
          <span>Possession</span>
        </div>
      </div>

      {insight ? (
        <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-orange-600/15 to-amber-600/15 border border-orange-500/30">
          <p className="text-xs text-white/70 leading-relaxed">{insight}</p>
        </div>
      ) : insightLoading ? (
        <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/10 animate-pulse">
          <div className="h-3 bg-white/10 rounded w-3/4 mb-1.5" />
          <div className="h-3 bg-white/10 rounded w-1/2" />
        </div>
      ) : null}
    </div>
  )
}
