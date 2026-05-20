import { useState, useEffect, Component, type ReactNode, type ErrorInfo } from 'react'
import { Plus, Shield, Check, AlertTriangle, Trash2 } from 'lucide-react'
import { useClub } from '../../contexts/ClubContext'
import { organizationsAPI } from '../../services/api'
import type { Organization } from '../../types'
import AddTeamModal from './AddTeamModal'

// Error boundary to catch and display render errors instead of blank screen
class TeamErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('TeamManagement render error:', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 rounded-xl bg-red-500/10 border border-red-500/20 text-center space-y-2">
          <AlertTriangle size={24} className="text-red-400 mx-auto" />
          <p className="text-red-400 font-semibold">Something went wrong</p>
          <p className="text-red-400/70 text-xs font-mono break-all">{String(this.state.error?.message || this.state.error)}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="text-xs text-cyan-400 hover:underline mt-2"
          >
            Try Again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

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
  const [showAddModal, setShowAddModal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ clubId: string; clubName: string } | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

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

  const handleTeamCreated = async (_club: any) => {
    setShowAddModal(false)
    setSuccess('Team created successfully')
    await loadOrg()
    refetch()
  }

  const handleSwitchToTeam = async (clubId: string) => {
    try {
      await switchClub(clubId)
    } catch (err: any) {
      setError(err.message || 'Failed to switch team')
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await organizationsAPI.deactivateTeam(deleteTarget.clubId)
      setDeleteTarget(null)
      setSuccess(`"${deleteTarget.clubName}" has been removed`)
      await loadOrg()
      refetch()
    } catch (err: any) {
      setError(err.message || 'Failed to delete team')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
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
    <TeamErrorBoundary>
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
                <>
                  <button
                    onClick={() => handleSwitchToTeam(m.club_id)}
                    className="text-xs text-white/50 hover:text-white px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    Switch
                  </button>
                  <button
                    onClick={() => { setDeleteTarget({ clubId: m.club_id, clubName: m.club_name }); setDeleteConfirmText('') }}
                    className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Delete team"
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add Team */}
      {canAddTeam ? (
        <button
          onClick={() => { setShowAddModal(true); setSuccess(null) }}
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

      {/* Add Team Modal */}
      <AddTeamModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={handleTeamCreated}
      />

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-white font-semibold">Delete Team</h3>
                <p className="text-white/50 text-sm">This cannot be undone</p>
              </div>
            </div>
            <p className="text-white/70 text-sm">
              Are you sure you want to delete <span className="text-white font-medium">"{deleteTarget.clubName}"</span>? All match data, players, and records for this team will be permanently removed.
            </p>
            <div className="space-y-2">
              <label className="text-xs text-white/40 uppercase tracking-wide">
                Type <span className="text-red-400 font-mono font-bold">DELETE</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                autoFocus
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm font-mono placeholder:text-white/20 focus:outline-none focus:border-red-500/40"
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setDeleteTarget(null); setDeleteConfirmText('') }}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-white/70 hover:text-white hover:border-white/20 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting || deleteConfirmText !== 'DELETE'}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting…' : 'Delete Team'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </TeamErrorBoundary>
  )
}
