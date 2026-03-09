import { useState, useEffect } from 'react'
import { Plus, Shield, Check, AlertTriangle } from 'lucide-react'
import { useClub } from '../../contexts/ClubContext'
import { organizationsAPI } from '../../services/api'
import type { Organization } from '../../types'

const TIER_LABELS: Record<string, string> = {
  free: 'Free',
  club: 'Club',
  pro: 'Pro',
  elite: 'Elite',
}

const TIER_COLORS: Record<string, string> = {
  free: 'text-white/50 bg-white/5 border-white/10',
  club: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  pro: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  elite: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
}

export default function TeamManagementSettings() {
  const { club, clubs, switchClub, refetch } = useClub()
  const [org, setOrg] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamShortName, setNewTeamShortName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    loadOrg()
  }, [])

  const loadOrg = async () => {
    try {
      const data = await organizationsAPI.getOrganization()
      setOrg(data)
    } catch {
      // Org may not exist yet for legacy users
    } finally {
      setLoading(false)
    }
  }

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return
    setCreating(true)
    setError(null)
    try {
      await organizationsAPI.createTeam({
        name: newTeamName.trim(),
        short_name: newTeamShortName.trim() || undefined,
      })
      setSuccess(`Team "${newTeamName.trim()}" created successfully`)
      setNewTeamName('')
      setNewTeamShortName('')
      setShowAddForm(false)
      await loadOrg()
      refetch()
    } catch (err: any) {
      setError(err.message || 'Failed to create team')
    } finally {
      setCreating(false)
    }
  }

  const handleSwitchToTeam = async (clubId: string) => {
    try {
      await switchClub(clubId)
    } catch (err: any) {
      setError(err.message || 'Failed to switch team')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const canAddTeam = org ? org.current_team_count < org.max_teams : false
  const tierLabel = TIER_LABELS[org?.subscription_tier || 'free'] || 'Free'
  const tierColor = TIER_COLORS[org?.subscription_tier || 'free'] || TIER_COLORS.free

  return (
    <div className="space-y-6">
      {/* Org & Tier Info */}
      {org && (
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">{org.name}</h3>
            <p className="text-sm text-white/50">
              {org.current_team_count} / {org.max_teams === 999 ? 'Unlimited' : org.max_teams} teams
            </p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${tierColor}`}>
            {tierLabel} Plan
          </span>
        </div>
      )}

      {/* Success/Error */}
      {success && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
          <Check size={16} />
          {success}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Team List */}
      <div className="space-y-2">
        {clubs.map((m) => (
          <div
            key={m.club_id}
            className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
              m.club_id === club?.id
                ? 'bg-emerald-500/5 border-emerald-500/20'
                : 'bg-white/[0.03] border-white/[0.06] hover:border-white/10'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center">
                <Shield size={18} className={m.club_id === club?.id ? 'text-emerald-400' : 'text-white/30'} />
              </div>
              <div>
                <p className="text-sm font-medium text-white">{m.club_name}</p>
                <p className="text-xs text-white/40 capitalize">{m.role.replace('_', ' ')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {m.club_id === club?.id ? (
                <span className="text-xs text-emerald-400 font-medium px-2 py-1 rounded bg-emerald-500/10">
                  Active
                </span>
              ) : (
                <button
                  onClick={() => handleSwitchToTeam(m.club_id)}
                  className="text-xs text-white/50 hover:text-white px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Switch
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add Team */}
      {showAddForm ? (
        <div className="p-4 rounded-xl border border-white/10 bg-white/[0.03] space-y-4">
          <h4 className="text-sm font-medium text-white">Add New Team</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/50 mb-1">Team Name *</label>
              <input
                type="text"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="e.g. Donegal Senior"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">Short Name</label>
              <input
                type="text"
                value={newTeamShortName}
                onChange={(e) => setNewTeamShortName(e.target.value)}
                placeholder="e.g. Donegal"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateTeam}
              disabled={!newTeamName.trim() || creating}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-50 transition-colors"
            >
              {creating ? 'Creating...' : 'Create Team'}
            </button>
            <button
              onClick={() => { setShowAddForm(false); setError(null) }}
              className="px-4 py-2 rounded-lg text-sm text-white/50 hover:text-white hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : canAddTeam ? (
        <button
          onClick={() => { setShowAddForm(true); setSuccess(null) }}
          className="flex items-center gap-2 px-4 py-3 rounded-xl border border-dashed border-white/10 hover:border-emerald-500/30 text-white/50 hover:text-emerald-400 transition-colors w-full justify-center"
        >
          <Plus size={16} />
          <span className="text-sm">Add Team</span>
        </button>
      ) : org && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-500/5 border border-amber-500/10 text-amber-400/70 text-sm">
          <AlertTriangle size={16} />
          Team limit reached on your {tierLabel} plan. Upgrade to add more teams.
        </div>
      )}
    </div>
  )
}
