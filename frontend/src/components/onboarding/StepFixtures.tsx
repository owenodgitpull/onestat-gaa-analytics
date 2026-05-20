import { useState, useRef, useCallback } from 'react'
import { Upload, FileSpreadsheet, FileText, Check, Loader2, CalendarDays, AlertTriangle } from 'lucide-react'
import { api } from '../../services/api'
import { useClub } from '../../contexts/ClubContext'

interface StepFixturesProps {
  onSkip: () => void
  onImported: () => void
}

type Step = 'file' | 'team-select' | 'importing' | 'done'

export default function StepFixtures({ onSkip, onImported }: StepFixturesProps) {
  const { club } = useClub()
  const [step, setStep] = useState<Step>('file')
  const [file, setFile] = useState<File | null>(null)
  const [teams, setTeams] = useState<string[]>([])
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [importResult, setImportResult] = useState<{ created: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasAliases = (club?.team_aliases?.length ?? 0) > 0
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

  const doImport = useCallback(async (teamOverride?: string) => {
    if (!file) return
    setStep('importing')
    setError(null)
    try {
      const result = await api.fixtures.importFile(file, 'add', teamOverride || selectedTeam || undefined)
      setImportResult({ created: result.created })
      setStep('done')
    } catch (err: any) {
      setError(err.message || 'Import failed')
      setStep('file')
    }
  }, [file, selectedTeam])

  const handleNext = async () => {
    if (!file) return
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
        setError(err.message || 'Failed to read file')
      } finally {
        setLoadingTeams(false)
      }
      return
    }
    await doImport()
  }

  const isKnownName = (team: string) => {
    const lower = team.toLowerCase()
    return (
      lower === (club?.name || '').toLowerCase() ||
      lower === (club?.short_name || '').toLowerCase()
    )
  }

  if (step === 'done' && importResult) {
    return (
      <div className="space-y-6">
        <div className="text-center py-6">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
            <Check size={28} className="text-emerald-400" />
          </div>
          <h3 className="text-white font-semibold text-lg mb-1">Fixtures Imported</h3>
          <p className="text-white/50 text-sm">{importResult.created} fixture{importResult.created !== 1 ? 's' : ''} added to your calendar.</p>
        </div>
        <button
          onClick={onImported}
          className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
          style={{ background: 'var(--gradient-primary)', color: '#0a1a10', border: '1px solid rgba(0,230,118,0.3)' }}
        >
          Continue to Review
        </button>
      </div>
    )
  }

  if (step === 'importing') {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <Loader2 size={32} className="text-emerald-400 animate-spin" />
        <p className="text-sm text-white/60">Importing fixtures...</p>
      </div>
    )
  }

  if (step === 'team-select') {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-sm text-white/70 mb-1">Select your club from the teams found in this file:</p>
          <p className="text-xs text-white/40">This will be saved so you won't need to select it again.</p>
        </div>
        <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1 -mr-1">
          {teams.map((team) => {
            const known = isKnownName(team)
            const active = selectedTeam === team
            return (
              <button
                key={team}
                onClick={() => setSelectedTeam(team)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-all border ${
                  active
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : known
                      ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/15'
                      : 'bg-white/[0.03] border-white/10 text-white/70 hover:bg-white/[0.06]'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${active ? 'border-emerald-400 bg-emerald-500' : 'border-white/20'}`}>
                  {active && <Check size={12} className="text-white" />}
                </div>
                <span className="truncate">{team}</span>
                {known && !active && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 flex-shrink-0">Likely match</span>
                )}
              </button>
            )
          })}
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-3 pt-1">
          <button
            onClick={() => { setStep('file'); setSelectedTeam(null); setTeams([]) }}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/70 hover:text-white text-sm transition-colors"
          >
            Back
          </button>
          <button
            onClick={() => selectedTeam && doImport(selectedTeam)}
            disabled={!selectedTeam}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
            style={selectedTeam ? { background: 'var(--gradient-primary)', color: '#0a1a10', border: '1px solid rgba(0,230,118,0.3)' } : {}}
          >
            Import
          </button>
        </div>
        <button onClick={onSkip} className="w-full text-xs text-white/30 hover:text-white/50 py-1 transition-colors">
          Skip for now
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">Import Fixtures</h2>
        <p className="text-white/50 text-sm">Upload your season fixture list so your calendar is ready to go. You can skip this and do it later.</p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
          file
            ? 'border-emerald-500/40 bg-emerald-500/5'
            : 'border-white/15 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.04]'
        }`}
      >
        {file ? (
          <>
            {isXlsx ? <FileSpreadsheet size={32} className="text-emerald-400" /> : <FileText size={32} className="text-emerald-400" />}
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

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <AlertTriangle size={14} className="flex-shrink-0" />
          {error}
        </div>
      )}

      <button
        onClick={handleNext}
        disabled={!file || loadingTeams}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
        style={file ? { background: 'var(--gradient-primary)', color: '#0a1a10', border: '1px solid rgba(0,230,118,0.3)' } : {}}
      >
        {loadingTeams ? (
          <><Loader2 size={16} className="animate-spin" /> Reading file...</>
        ) : (
          <><Upload size={16} /> {isXlsx && !hasAliases ? 'Next' : 'Import Fixtures'}</>
        )}
      </button>

      {/* Skip */}
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
        <CalendarDays size={15} className="text-white/30 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-white/40">
          You can always import fixtures later via the <strong className="text-white/60">Calendar</strong> icon in the menu.
        </p>
      </div>

      <button
        onClick={onSkip}
        className="w-full text-sm text-white/40 hover:text-white/70 py-1.5 transition-colors"
      >
        Skip for now →
      </button>
    </div>
  )
}
