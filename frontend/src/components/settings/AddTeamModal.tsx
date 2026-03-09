/**
 * AddTeamModal — Multi-step wizard for creating a new team within an organization.
 *
 * Step 1: Team details (name, county, ground)
 * Step 2: Branding (colours, logo)
 * Step 3: Roster import (CSV/XLSX or manual) — optional
 *
 * Creates club via /organization/teams, uploads logo, then optionally imports players.
 */

import { useState, useRef, useCallback } from 'react'
import {
  X, ChevronRight, ChevronLeft, Check, Upload, Plus, Trash2,
  FileSpreadsheet, UserPlus, AlertTriangle, ImageUp,
} from 'lucide-react'
import { organizationsAPI, fetchAPI, API_BASE } from '../../services/api'
import type { Club } from '../../types'

interface AddTeamModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (club: Club) => void
}

// ── County / Province data ─────────────────────────────────────────────

const COUNTIES = [
  'Antrim', 'Armagh', 'Carlow', 'Cavan', 'Clare', 'Cork', 'Derry', 'Donegal',
  'Down', 'Dublin', 'Fermanagh', 'Galway', 'Kerry', 'Kildare', 'Kilkenny',
  'Laois', 'Leitrim', 'Limerick', 'Longford', 'Louth', 'Mayo', 'Meath',
  'Monaghan', 'Offaly', 'Roscommon', 'Sligo', 'Tipperary', 'Tyrone',
  'Waterford', 'Westmeath', 'Wexford', 'Wicklow',
]

const PROVINCE_MAP: Record<string, string> = {
  Antrim: 'Ulster', Armagh: 'Ulster', Cavan: 'Ulster', Derry: 'Ulster',
  Donegal: 'Ulster', Down: 'Ulster', Fermanagh: 'Ulster', Monaghan: 'Ulster', Tyrone: 'Ulster',
  Clare: 'Munster', Cork: 'Munster', Kerry: 'Munster', Limerick: 'Munster',
  Tipperary: 'Munster', Waterford: 'Munster',
  Carlow: 'Leinster', Dublin: 'Leinster', Kildare: 'Leinster', Kilkenny: 'Leinster',
  Laois: 'Leinster', Longford: 'Leinster', Louth: 'Leinster', Meath: 'Leinster',
  Offaly: 'Leinster', Westmeath: 'Leinster', Wexford: 'Leinster', Wicklow: 'Leinster',
  Galway: 'Connacht', Leitrim: 'Connacht', Mayo: 'Connacht', Roscommon: 'Connacht', Sligo: 'Connacht',
}

const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward']

interface ManualPlayer {
  name: string
  position: string
  jersey_number: string
}

// ── Component ──────────────────────────────────────────────────────────

export default function AddTeamModal({ isOpen, onClose, onCreated }: AddTeamModalProps) {
  const [step, setStep] = useState(1)
  const totalSteps = 3

  // Step 1: Details
  const [name, setName] = useState('')
  const [shortName, setShortName] = useState('')
  const [county, setCounty] = useState('')
  const [province, setProvince] = useState('')
  const [homeGround, setHomeGround] = useState('')

  // Step 2: Branding
  const [primaryColour, setPrimaryColour] = useState('#1e40af')
  const [secondaryColour, setSecondaryColour] = useState('#ffffff')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  // Step 3: Players
  const [playerTab, setPlayerTab] = useState<'upload' | 'manual'>('manual')
  const [manualPlayers, setManualPlayers] = useState<ManualPlayer[]>([])
  const [playerForm, setPlayerForm] = useState<ManualPlayer>({ name: '', position: '', jersey_number: '' })
  const [uploadedPlayers, setUploadedPlayers] = useState<Array<{ name: string; position?: string; jersey_number?: number }>>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  // Shared
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdClubId, setCreatedClubId] = useState<string | null>(null)

  if (!isOpen) return null

  const handleCountyChange = (c: string) => {
    setCounty(c)
    setProvince(PROVINCE_MAP[c] || '')
  }

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setLogoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const clearLogo = () => {
    setLogoPreview(null)
    setLogoFile(null)
    if (logoInputRef.current) logoInputRef.current.value = ''
  }

  const addManualPlayer = () => {
    if (!playerForm.name.trim()) return
    setManualPlayers([...manualPlayers, { ...playerForm }])
    setPlayerForm({ name: '', position: '', jersey_number: '' })
  }

  const removePlayer = (idx: number) => {
    setManualPlayers(manualPlayers.filter((_, i) => i !== idx))
  }

  // File upload for roster
  const handleFile = useCallback(async (file: File, clubId: string) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['csv', 'xlsx', 'xls'].includes(ext || '')) {
      setUploadError('Please upload a CSV or Excel file.')
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${API_BASE}/onboarding/club/${clubId}/players/preview`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      if (!res.ok) throw new Error('Failed to parse file')
      const result = await res.json()
      setUploadedPlayers(result.rows || [])
    } catch (err: any) {
      setUploadError(err.message || 'Failed to parse file.')
    } finally {
      setUploading(false)
    }
  }, [])

  const canProceed = () => {
    if (step === 1) return name.trim().length > 0
    return true
  }

  // Create team on step 2 → 3 transition (or on finish if skipping step 3)
  const createTeam = async (): Promise<string> => {
    if (createdClubId) return createdClubId

    const result = await organizationsAPI.createTeam({
      name: name.trim(),
      short_name: shortName.trim() || undefined,
      county: county || undefined,
      province: province || undefined,
      primary_colour: primaryColour,
      secondary_colour: secondaryColour,
    }) as Club

    setCreatedClubId(result.id)

    // Upload logo if selected
    if (logoFile) {
      try {
        const formData = new FormData()
        formData.append('file', logoFile)
        await fetch(`${API_BASE}/onboarding/club/${result.id}/logo`, {
          method: 'POST',
          credentials: 'include',
          body: formData,
        })
      } catch {
        // Non-blocking
      }
    }

    return result.id
  }

  const handleNext = async () => {
    setError(null)

    if (step === 2) {
      // Create the team before moving to roster step
      setLoading(true)
      try {
        await createTeam()
      } catch (err: any) {
        setError(err.message || 'Failed to create team')
        setLoading(false)
        return
      }
      setLoading(false)
    }

    setStep((s) => Math.min(s + 1, totalSteps))
  }

  const handleFinish = async () => {
    setError(null)
    setLoading(true)

    try {
      let clubId = createdClubId

      // If we haven't created the team yet (skipped straight to finish)
      if (!clubId) {
        clubId = await createTeam()
      }

      // Import players if any
      const allPlayers = [
        ...uploadedPlayers.map(p => ({ name: p.name, position: p.position, jersey_number: p.jersey_number })),
        ...manualPlayers.map(p => ({
          name: p.name,
          position: p.position || undefined,
          jersey_number: p.jersey_number ? parseInt(p.jersey_number, 10) : undefined,
        })),
      ]

      if (allPlayers.length > 0) {
        await fetchAPI(`/onboarding/club/${clubId}/players/confirm`, {
          method: 'POST',
          body: JSON.stringify({ players: allPlayers }),
        })
      }

      // Mark onboarding complete for the new club
      await fetchAPI(`/onboarding/club/${clubId}/complete`, { method: 'PATCH' })

      // Return the created club
      const clubRes = await fetch(`${API_BASE}/club/`, { credentials: 'include' })
      const club = await clubRes.json()

      onCreated(club)
      resetAndClose()
    } catch (err: any) {
      setError(err.message || 'Failed to complete team setup')
    } finally {
      setLoading(false)
    }
  }

  const resetAndClose = () => {
    setStep(1)
    setName('')
    setShortName('')
    setCounty('')
    setProvince('')
    setHomeGround('')
    setPrimaryColour('#1e40af')
    setSecondaryColour('#ffffff')
    setLogoFile(null)
    setLogoPreview(null)
    setManualPlayers([])
    setPlayerForm({ name: '', position: '', jersey_number: '' })
    setUploadedPlayers([])
    setCreatedClubId(null)
    setError(null)
    onClose()
  }

  const allPlayerCount = uploadedPlayers.length + manualPlayers.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={resetAndClose} />

      {/* Modal */}
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl"
        style={{
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(10, 16, 36, 0.98))',
          border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-white/10" style={{ background: 'rgba(15, 23, 42, 0.95)', backdropFilter: 'blur(12px)' }}>
          <div>
            <h2 className="text-lg font-bold text-white">Add New Team</h2>
            <p className="text-xs text-white/40 mt-0.5">Step {step} of {totalSteps}</p>
          </div>
          <button onClick={resetAndClose} className="p-2 rounded-lg hover:bg-white/5 transition-colors">
            <X size={18} className="text-white/40" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-6 pt-4">
          <div className="flex gap-2">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div key={i} className="flex-1 h-1 rounded-full overflow-hidden bg-white/5">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: i < step ? '100%' : i === step - 1 ? '50%' : '0%',
                    background: 'linear-gradient(90deg, #10b981, #06b6d4)',
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-white/30 font-medium">
            <span className={step >= 1 ? 'text-emerald-400/70' : ''}>Details</span>
            <span className={step >= 2 ? 'text-emerald-400/70' : ''}>Branding</span>
            <span className={step >= 3 ? 'text-emerald-400/70' : ''}>Roster</span>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-5">
          {/* ── Step 1: Details ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">
                  Team Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Donegal Senior Football"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">Short Name</label>
                <input
                  type="text"
                  value={shortName}
                  onChange={(e) => setShortName(e.target.value)}
                  placeholder="e.g. Donegal"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1.5">County</label>
                  <select
                    value={county}
                    onChange={(e) => handleCountyChange(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50 appearance-none cursor-pointer"
                  >
                    <option value="" className="bg-[#0a1024] text-white/50">Select...</option>
                    {COUNTIES.map((c) => (
                      <option key={c} value={c} className="bg-[#0a1024] text-white">{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1.5">Province</label>
                  <input
                    type="text"
                    value={province}
                    readOnly
                    placeholder="Auto-filled"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/40 text-sm cursor-not-allowed"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">Home Ground</label>
                <input
                  type="text"
                  value={homeGround}
                  onChange={(e) => setHomeGround(e.target.value)}
                  placeholder="e.g. MacCumhaill Park"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>
            </div>
          )}

          {/* ── Step 2: Branding ── */}
          {step === 2 && (
            <div className="space-y-5">
              {/* Colours */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1.5">Primary Colour</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={primaryColour}
                      onChange={(e) => setPrimaryColour(e.target.value)}
                      className="w-10 h-10 rounded-lg cursor-pointer border border-white/10 bg-transparent"
                    />
                    <input
                      type="text"
                      value={primaryColour}
                      onChange={(e) => setPrimaryColour(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm font-mono uppercase focus:outline-none focus:border-emerald-500/50"
                      maxLength={7}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1.5">Secondary Colour</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={secondaryColour}
                      onChange={(e) => setSecondaryColour(e.target.value)}
                      className="w-10 h-10 rounded-lg cursor-pointer border border-white/10 bg-transparent"
                    />
                    <input
                      type="text"
                      value={secondaryColour}
                      onChange={(e) => setSecondaryColour(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm font-mono uppercase focus:outline-none focus:border-emerald-500/50"
                      maxLength={7}
                    />
                  </div>
                </div>
              </div>

              {/* Jersey preview */}
              <div className="flex justify-center py-3">
                <div className="flex items-center gap-6">
                  <svg width="80" height="96" viewBox="0 0 100 120" fill="none">
                    <path d="M25 30 L5 45 L5 55 L20 50 L20 110 L80 110 L80 50 L95 55 L95 45 L75 30 L65 15 L35 15 Z" fill={primaryColour} stroke={secondaryColour} strokeWidth="2" />
                    <path d="M35 15 Q50 25 65 15" fill="none" stroke={secondaryColour} strokeWidth="2" />
                    <rect x="20" y="55" width="60" height="15" fill={secondaryColour} opacity="0.5" />
                    <text x="50" y="85" textAnchor="middle" fill={secondaryColour} fontSize="24" fontWeight="bold" fontFamily="sans-serif">1</text>
                  </svg>
                  <div
                    className="w-16 h-16 rounded-full border-4 flex items-center justify-center"
                    style={{ backgroundColor: primaryColour, borderColor: secondaryColour }}
                  >
                    {logoPreview ? (
                      <img src={logoPreview} alt="" className="w-11 h-11 rounded-full object-cover" />
                    ) : (
                      <span className="text-sm font-bold" style={{ color: secondaryColour }}>
                        {shortName?.slice(0, 3).toUpperCase() || name?.slice(0, 3).toUpperCase() || 'GAA'}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Logo upload */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">Team Logo</label>
                {logoPreview ? (
                  <div className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.03] border border-white/10">
                    <img src={logoPreview} alt="" className="w-12 h-12 rounded-lg object-cover border border-white/10" />
                    <div className="flex-1 text-sm text-white/60">Logo selected</div>
                    <button onClick={clearLogo} className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors">
                      <X size={14} className="text-white/50 hover:text-red-300" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    className="w-full p-6 rounded-xl border border-dashed border-white/10 hover:border-emerald-500/30 flex flex-col items-center gap-2 transition-colors group"
                  >
                    <ImageUp size={20} className="text-white/30 group-hover:text-emerald-400 transition-colors" />
                    <span className="text-xs text-white/40 group-hover:text-white/60">Click to upload logo</span>
                  </button>
                )}
                <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoSelect} className="hidden" />
              </div>
            </div>
          )}

          {/* ── Step 3: Roster ── */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-white/50">Import your squad or add players manually. You can skip this and add players later.</p>

              {/* Tabs */}
              <div className="flex gap-2">
                <button
                  onClick={() => setPlayerTab('upload')}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    playerTab === 'upload' ? 'bg-emerald-500/20 border border-emerald-400/30 text-white' : 'bg-white/5 border border-white/10 text-white/50 hover:text-white/70'
                  }`}
                >
                  <FileSpreadsheet size={14} />
                  Upload File
                </button>
                <button
                  onClick={() => setPlayerTab('manual')}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    playerTab === 'manual' ? 'bg-emerald-500/20 border border-emerald-400/30 text-white' : 'bg-white/5 border border-white/10 text-white/50 hover:text-white/70'
                  }`}
                >
                  <UserPlus size={14} />
                  Manual Entry
                </button>
              </div>

              {/* Upload */}
              {playerTab === 'upload' && (
                <div className="space-y-3">
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragOver(false)
                      const file = e.dataTransfer.files[0]
                      if (file && createdClubId) handleFile(file, createdClubId)
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`p-8 rounded-xl border border-dashed flex flex-col items-center gap-3 cursor-pointer transition-all group ${
                      dragOver ? 'border-emerald-400/50 bg-emerald-500/10' : 'border-white/10 hover:border-emerald-400/30'
                    }`}
                  >
                    {uploading ? (
                      <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Upload size={20} className="text-white/30 group-hover:text-emerald-400 transition-colors" />
                    )}
                    <span className="text-xs text-white/40">{uploading ? 'Parsing...' : 'Drag CSV/Excel or click to browse'}</span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file && createdClubId) handleFile(file, createdClubId)
                    }}
                    className="hidden"
                  />
                  {uploadError && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                      <AlertTriangle size={14} />
                      {uploadError}
                    </div>
                  )}
                  {uploadedPlayers.length > 0 && (
                    <p className="text-xs text-emerald-400">{uploadedPlayers.length} players parsed from file</p>
                  )}
                </div>
              )}

              {/* Manual */}
              {playerTab === 'manual' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
                    <div>
                      <label className="block text-[10px] text-white/40 mb-1">Name *</label>
                      <input
                        type="text"
                        value={playerForm.name}
                        onChange={(e) => setPlayerForm({ ...playerForm, name: e.target.value })}
                        placeholder="Player name"
                        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                        onKeyDown={(e) => { if (e.key === 'Enter') addManualPlayer() }}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-white/40 mb-1">Position</label>
                      <select
                        value={playerForm.position}
                        onChange={(e) => setPlayerForm({ ...playerForm, position: e.target.value })}
                        className="px-2 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none appearance-none cursor-pointer"
                      >
                        <option value="" className="bg-[#0a1024]">—</option>
                        {POSITIONS.map(p => <option key={p} value={p.toLowerCase()} className="bg-[#0a1024]">{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-white/40 mb-1">#</label>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={playerForm.jersey_number}
                        onChange={(e) => setPlayerForm({ ...playerForm, jersey_number: e.target.value })}
                        placeholder="#"
                        className="w-14 px-2 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                      />
                    </div>
                    <button
                      onClick={addManualPlayer}
                      disabled={!playerForm.name.trim()}
                      className="px-3 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-30 transition-colors"
                    >
                      <Plus size={16} />
                    </button>
                  </div>

                  {manualPlayers.length > 0 && (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {manualPlayers.map((p, i) => (
                        <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-white font-medium">{p.name}</span>
                            {p.position && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 capitalize">{p.position}</span>}
                            {p.jersey_number && <span className="text-white/30 text-xs">#{p.jersey_number}</span>}
                          </div>
                          <button onClick={() => removePlayer(i)} className="p-1 rounded hover:bg-red-500/20 transition-colors">
                            <Trash2 size={12} className="text-white/30 hover:text-red-400" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {allPlayerCount > 0 && (
                <div className="text-xs text-white/40 pt-1">
                  {allPlayerCount} player{allPlayerCount !== 1 ? 's' : ''} ready to import
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-between px-6 py-4 border-t border-white/10" style={{ background: 'rgba(15, 23, 42, 0.95)', backdropFilter: 'blur(12px)' }}>
          <button
            onClick={() => step > 1 ? setStep(s => s - 1) : resetAndClose()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm text-white/50 hover:text-white hover:bg-white/5 transition-colors"
          >
            <ChevronLeft size={14} />
            {step === 1 ? 'Cancel' : 'Back'}
          </button>

          <div className="flex items-center gap-2">
            {step === 3 && (
              <button
                onClick={handleFinish}
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-50 transition-colors"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Check size={14} />
                )}
                {allPlayerCount > 0 ? `Create with ${allPlayerCount} Players` : 'Create Team'}
              </button>
            )}
            {step < 3 && (
              <button
                onClick={handleNext}
                disabled={!canProceed() || loading}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-50 transition-colors"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    Next
                    <ChevronRight size={14} />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
