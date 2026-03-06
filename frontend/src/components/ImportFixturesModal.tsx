import { useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Upload, AlertTriangle, Loader2, Check, FileSpreadsheet, FileText } from 'lucide-react'
import { api } from '../services/api'
import type { CsvImportResult } from '../services/api'
import { useClub } from '../contexts/ClubContext'

interface ImportFixturesModalProps {
  isOpen: boolean
  onClose: () => void
  onImported: (result: CsvImportResult) => void
}

type Step = 'file' | 'team-select' | 'importing'

export default function ImportFixturesModal({ isOpen, onClose, onImported }: ImportFixturesModalProps) {
  const { club } = useClub()
  const [step, setStep] = useState<Step>('file')
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<'add' | 'replace'>('add')
  const [teams, setTeams] = useState<string[]>([])
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingTeams, setLoadingTeams] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasAliases = (club?.team_aliases?.length ?? 0) > 0

  const reset = useCallback(() => {
    setStep('file')
    setFile(null)
    setMode('add')
    setTeams([])
    setSelectedTeam(null)
    setError(null)
    setLoadingTeams(false)
  }, [])

  const handleClose = () => {
    reset()
    onClose()
  }

  const isXlsx = file?.name?.toLowerCase().endsWith('.xlsx')

  const handleFileChange = (f: File | null) => {
    setFile(f)
    setError(null)
    setSelectedTeam(null)
    setTeams([])
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f && (f.name.endsWith('.csv') || f.name.endsWith('.xlsx'))) {
      handleFileChange(f)
    } else {
      setError('Please drop a .csv or .xlsx file')
    }
  }

  const handleNext = async () => {
    if (!file) return

    // For XLSX without aliases: show team selection step
    if (isXlsx && !hasAliases) {
      setLoadingTeams(true)
      setError(null)
      try {
        const { teams: foundTeams } = await api.fixtures.previewTeams(file)
        if (foundTeams.length === 0) {
          setError('No teams found in this file. Check the file format.')
          setLoadingTeams(false)
          return
        }
        setTeams(foundTeams)
        setStep('team-select')
      } catch (err: any) {
        setError(err.message || 'Failed to parse file')
      } finally {
        setLoadingTeams(false)
      }
      return
    }

    // Otherwise go straight to import
    await doImport()
  }

  const doImport = async (teamOverride?: string) => {
    if (!file) return
    setStep('importing')
    setError(null)

    try {
      const result = await api.fixtures.importFile(
        file,
        mode,
        teamOverride || selectedTeam || undefined
      )
      onImported(result)
      handleClose()
    } catch (err: any) {
      setError(err.message || 'Import failed')
      setStep('file')
      }
  }

  const handleTeamConfirm = () => {
    if (!selectedTeam) return
    doImport(selectedTeam)
  }

  if (!isOpen) return null

  // Check if a team name matches club name or short_name (case-insensitive)
  const isKnownName = (team: string) => {
    const lower = team.toLowerCase()
    return (
      lower === (club?.name || '').toLowerCase() ||
      lower === (club?.short_name || '').toLowerCase()
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d1117]/95 backdrop-blur-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">Import Fixtures</h2>
          <button onClick={handleClose} className="p-1 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5">
          {/* Step 1: File & Mode Selection */}
          {step === 'file' && (
            <div className="space-y-5">
              {/* File drop zone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  relative flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all
                  ${file
                    ? 'border-emerald-500/40 bg-emerald-500/5'
                    : 'border-white/15 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.04]'
                  }
                `}
              >
                {file ? (
                  <>
                    {isXlsx
                      ? <FileSpreadsheet size={32} className="text-emerald-400" />
                      : <FileText size={32} className="text-emerald-400" />
                    }
                    <span className="text-sm text-white font-medium">{file.name}</span>
                    <span className="text-xs text-white/40">Click or drop to change</span>
                  </>
                ) : (
                  <>
                    <Upload size={32} className="text-white/30" />
                    <span className="text-sm text-white/60">Drop a <strong className="text-white/80">.csv</strong> or <strong className="text-white/80">.xlsx</strong> file here</span>
                    <span className="text-xs text-white/30">or click to browse</span>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx"
                  className="hidden"
                  onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                />
              </div>

              {/* Mode toggle */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Import mode</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setMode('add')}
                    className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all border ${
                      mode === 'add'
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                        : 'bg-white/[0.03] border-white/10 text-white/50 hover:bg-white/[0.06]'
                    }`}
                  >
                    Add to existing
                  </button>
                  <button
                    onClick={() => setMode('replace')}
                    className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all border ${
                      mode === 'replace'
                        ? 'bg-red-500/15 border-red-500/40 text-red-400'
                        : 'bg-white/[0.03] border-white/10 text-white/50 hover:bg-white/[0.06]'
                    }`}
                  >
                    Replace all
                  </button>
                </div>
                {mode === 'replace' && (
                  <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                    <AlertTriangle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-red-400/80">
                      All scheduled fixtures will be deleted before importing. Completed results are never affected.
                    </p>
                  </div>
                )}
              </div>

              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}

              <button
                onClick={handleNext}
                disabled={!file || loadingTeams}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40"
                style={{
                  background: file ? 'var(--gradient-primary)' : undefined,
                  color: file ? '#0a1a10' : undefined,
                  border: file ? '1px solid rgba(0,230,118,0.3)' : undefined,
                }}
              >
                {loadingTeams ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Reading file...
                  </>
                ) : (
                  <>
                    <Upload size={16} />
                    {isXlsx && !hasAliases ? 'Next' : 'Import'}
                  </>
                )}
              </button>
            </div>
          )}

          {/* Step 2: Team Selection (XLSX, no aliases) */}
          {step === 'team-select' && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-white/70 mb-1">
                  Select your club from the teams found in this file:
                </p>
                <p className="text-xs text-white/40">
                  This will be saved so you won't need to select it again.
                </p>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1 -mr-1">
                {teams.map((team) => {
                  const known = isKnownName(team)
                  const active = selectedTeam === team
                  return (
                    <button
                      key={team}
                      onClick={() => setSelectedTeam(team)}
                      className={`
                        w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-all border
                        ${active
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : known
                            ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/15'
                            : 'bg-white/[0.03] border-white/10 text-white/70 hover:bg-white/[0.06]'
                        }
                      `}
                    >
                      <div className={`
                        w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all
                        ${active ? 'border-emerald-400 bg-emerald-500' : 'border-white/20'}
                      `}>
                        {active && <Check size={12} className="text-white" />}
                      </div>
                      <span className="truncate">{team}</span>
                      {known && !active && (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 flex-shrink-0">
                          Likely match
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex gap-3">
                <button
                  onClick={() => { setStep('file'); setSelectedTeam(null); setTeams([]) }}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-white/[0.06] border border-white/10 text-white/70 hover:bg-white/[0.10] transition-all"
                >
                  Back
                </button>
                <button
                  onClick={handleTeamConfirm}
                  disabled={!selectedTeam}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40"
                  style={{
                    background: selectedTeam ? 'var(--gradient-primary)' : undefined,
                    color: selectedTeam ? '#0a1a10' : undefined,
                    border: selectedTeam ? '1px solid rgba(0,230,118,0.3)' : undefined,
                  }}
                >
                  <Upload size={16} />
                  Import
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Importing */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <Loader2 size={32} className="text-emerald-400 animate-spin" />
              <p className="text-sm text-white/60">Importing fixtures...</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
