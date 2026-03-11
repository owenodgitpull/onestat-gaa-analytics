import { useState, useEffect, useCallback } from 'react'
import { Shield, ShieldOff, UserX, UserCheck, Loader2, Copy, Check, UserPlus, Mail, Clock, RefreshCw } from 'lucide-react'
import { clubMembersAPI } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
// ClubContext no longer needed — invite code fetched from API
import type { ClubMember } from '../../types'

interface PendingInvitation {
  id: string
  invitee_email: string
  role: string
  status: string
  token: string
  expires_at: string
  created_at: string
  accepted_at: string | null
}

export default function UserManagementSettings() {
  const { user } = useAuth()
  const [members, setMembers] = useState<ClubMember[]>([])
  const [invitations, setInvitations] = useState<PendingInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [regeneratingCode, setRegeneratingCode] = useState(false)

  // Invite state
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState('club_admin')
  const [inviting, setInviting] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)

  const fetchMembers = useCallback(async () => {
    try {
      setLoading(true)
      const [membersData, invitationsData, codeData] = await Promise.all([
        clubMembersAPI.listMembers() as Promise<{ members: ClubMember[] }>,
        clubMembersAPI.listInvitations() as Promise<{ invitations: PendingInvitation[] }>,
        clubMembersAPI.getInviteCode().catch(() => ({ invite_code: null })),
      ])
      setMembers(membersData.members || [])
      setInvitations(invitationsData.invitations || [])
      if (codeData.invite_code) setInviteCode(codeData.invite_code)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchMembers() }, [fetchMembers])

  const handleRegenerateCode = async () => {
    setRegeneratingCode(true)
    try {
      const result = await clubMembersAPI.regenerateInviteCode()
      setInviteCode(result.invite_code)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setRegeneratingCode(false)
    }
  }

  const handleRoleChange = async (memberId: string, newRole: string) => {
    if (!confirm(`Change this user's role to ${newRole === 'club_admin' ? 'Admin' : 'Player'}?`)) return
    setActionLoading(memberId)
    try {
      await clubMembersAPI.changeRole(memberId, newRole)
      await fetchMembers()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const handleToggleActive = async (memberId: string, isActive: boolean) => {
    const action = isActive ? 'deactivate' : 'reactivate'
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} this user?`)) return
    setActionLoading(memberId)
    try {
      if (isActive) {
        await clubMembersAPI.deactivateUser(memberId)
      } else {
        await clubMembersAPI.reactivateUser(memberId)
      }
      await fetchMembers()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const handleInviteAdmin = async () => {
    if (!inviteEmail.trim() || !inviteName.trim()) return
    setInviting(true)
    setInviteError(null)
    setInviteSuccess(null)

    try {
      await clubMembersAPI.inviteAdmin(inviteEmail.trim(), inviteName.trim(), inviteRole)
      setInviteSuccess(`Invitation sent to ${inviteEmail.trim()}! They'll receive an email with a link to accept.`)
      setInviteEmail('')
      setInviteName('')
      setInviteRole('club_admin')
      setShowInviteForm(false)
      await fetchMembers()
    } catch (err: any) {
      setInviteError(err.message || 'Failed to send invite')
    } finally {
      setInviting(false)
    }
  }

  const inviteUrl = inviteCode ? `${window.location.origin}/join/${inviteCode}` : ''

  const copyInviteLink = () => {
    if (!inviteUrl) return
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isSelf = (id: string) => id === user?.id

  const inputClass = "w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors text-sm [&>option]:bg-slate-800 [&>option]:text-white"

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">User Management</h2>
        <p className="text-sm text-white/50 mt-1">Manage who can access your club's analytics</p>
      </div>

      {/* Invite User */}
      <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-white/70">Invite User</h3>
            <p className="text-xs text-white/40">Send an invitation email to join this team</p>
          </div>
          {!showInviteForm && (
            <button
              onClick={() => setShowInviteForm(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{ background: 'var(--gradient-primary)', color: '#0a1a10', border: '1px solid rgba(0,230,118,0.3)', boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3)' }}
            >
              <UserPlus size={14} />
              Invite
            </button>
          )}
        </div>

        {showInviteForm && (
          <div className="space-y-3 pt-2 border-t border-white/[0.06]">
            <p className="text-xs text-white/40">They'll receive a branded email with a link to accept or decline the invitation.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-white/50 mb-1">Name</label>
                <input
                  className={inputClass}
                  placeholder="e.g. John Murphy"
                  value={inviteName}
                  onChange={e => setInviteName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Email</label>
                <input
                  className={inputClass}
                  type="email"
                  placeholder="john@example.com"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Role</label>
                <select
                  className={inputClass}
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value)}
                >
                  <option value="club_admin">Admin</option>
                  <option value="player">Player</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleInviteAdmin}
                disabled={inviting || !inviteEmail.trim() || !inviteName.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
                style={{ background: 'var(--gradient-primary)', color: '#0a1a10', border: '1px solid rgba(0,230,118,0.3)' }}
              >
                {inviting ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                {inviting ? 'Sending...' : 'Send Invitation'}
              </button>
              <button
                onClick={() => { setShowInviteForm(false); setInviteEmail(''); setInviteName(''); setInviteRole('club_admin'); setInviteError(null) }}
                className="px-4 py-2 rounded-lg text-sm text-white/50 hover:text-white hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
            {inviteError && (
              <p className="text-sm text-red-400">{inviteError}</p>
            )}
            </div>
          </div>
        )}

        {inviteSuccess && (
          <p className="text-sm text-emerald-400">{inviteSuccess}</p>
        )}

        {/* Pending invitations */}
        {invitations.filter(i => i.status === 'pending').length > 0 && (
          <div className="pt-3 border-t border-white/[0.06] space-y-2">
            <h4 className="text-xs font-medium text-white/40 flex items-center gap-1.5">
              <Clock size={12} /> Pending Invitations
            </h4>
            {invitations.filter(i => i.status === 'pending').map(inv => (
              <div key={inv.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <Mail size={14} className="text-amber-400/60 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white/70 truncate">{inv.invitee_email}</p>
                  <p className="text-[10px] text-white/30">
                    Sent {new Date(inv.created_at).toLocaleDateString()} · Expires {new Date(inv.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                  inv.role === 'club_admin'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                }`}>
                  {inv.role === 'club_admin' ? 'Admin' : 'Player'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Player Invite link */}
      <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-white/70">Player Invite Link</h3>
            <p className="text-xs text-white/40">Share this link with players to let them join your club</p>
          </div>
          {inviteCode && (
            <button
              onClick={handleRegenerateCode}
              disabled={regeneratingCode}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
              title="Generate a new code (invalidates the old link)"
            >
              <RefreshCw size={12} className={regeneratingCode ? 'animate-spin' : ''} />
              New Code
            </button>
          )}
        </div>
        {inviteUrl ? (
          <div className="flex items-center gap-2">
            <input readOnly value={inviteUrl} className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/60 text-sm" />
            <button
              onClick={copyInviteLink}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-white/30 text-sm py-2">
            <Loader2 size={14} className="animate-spin" /> Loading invite link...
          </div>
        )}
      </div>

      {/* Members list */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-white/30" /></div>
      ) : (
        <div className="space-y-2">
          {members.map(member => (
            <div key={member.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-white/70">
                  {member.name?.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)}
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white truncate">{member.name}</p>
                  {isSelf(member.id) && <span className="text-xs text-emerald-400">(you)</span>}
                  {!member.last_login_at && <span className="text-xs text-white/25 italic">pending signup</span>}
                </div>
                <p className="text-xs text-white/40 truncate">{member.email}</p>
              </div>

              {/* Role badge */}
              <span className={`text-xs px-2 py-1 rounded-full border ${
                member.role === 'club_admin'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              }`}>
                {member.role === 'club_admin' ? 'Admin' : 'Player'}
              </span>

              {/* Status */}
              {!member.is_active && (
                <span className="text-xs px-2 py-1 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">Inactive</span>
              )}

              {/* Actions (hidden for self) */}
              {!isSelf(member.id) && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleRoleChange(member.id, member.role === 'club_admin' ? 'player' : 'club_admin')}
                    disabled={actionLoading === member.id}
                    className="p-1.5 rounded-lg hover:bg-white/5 text-white/30 hover:text-amber-400 transition-colors disabled:opacity-50"
                    title={member.role === 'club_admin' ? 'Demote to Player' : 'Promote to Admin'}
                  >
                    {actionLoading === member.id ? <Loader2 size={14} className="animate-spin" /> :
                      member.role === 'club_admin' ? <ShieldOff size={14} /> : <Shield size={14} />}
                  </button>
                  <button
                    onClick={() => handleToggleActive(member.id, member.is_active)}
                    disabled={actionLoading === member.id}
                    className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                      member.is_active ? 'hover:bg-red-500/10 text-white/30 hover:text-red-400' : 'hover:bg-emerald-500/10 text-white/30 hover:text-emerald-400'
                    }`}
                    title={member.is_active ? 'Deactivate' : 'Reactivate'}
                  >
                    {member.is_active ? <UserX size={14} /> : <UserCheck size={14} />}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
