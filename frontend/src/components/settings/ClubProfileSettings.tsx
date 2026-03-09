import { useState, useEffect, useRef } from 'react'
import { Save, Loader2, Upload, Check, UserPlus, RefreshCw, Minus, Camera } from 'lucide-react'
import { useClub } from '../../contexts/ClubContext'
import { fetchAPI, playersAPI } from '../../services/api'
import { API_BASE } from '../../services/api'

export default function ClubProfileSettings() {
  const { club, refetch, logoUrl } = useClub()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    name: '',
    short_name: '',
    county: '',
    province: '',
    home_ground: '',
    primary_colour: '#00e676',
    secondary_colour: '#ffffff',
    team_aliases: '' as string,
  })

  useEffect(() => {
    if (club) {
      setForm({
        name: club.name || '',
        short_name: club.short_name || '',
        county: club.county || '',
        province: club.province || '',
        home_ground: club.home_ground || '',
        primary_colour: club.primary_colour || '#00e676',
        secondary_colour: club.secondary_colour || '#ffffff',
        team_aliases: (club.team_aliases || []).join(', '),
      })
    }
  }, [club])

  const handleSave = async () => {
    if (!club) return
    setSaving(true)
    setError(null)
    setSaved(false)

    try {
      const payload = {
        ...form,
        team_aliases: form.team_aliases
          ? form.team_aliases.split(',').map(s => s.trim()).filter(Boolean)
          : [],
      }
      await fetchAPI(`/club/${club.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      refetch()
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !club) return
    setUploadingLogo(true)
    setError(null)
    try {
      // Show local preview immediately
      setLogoPreview(URL.createObjectURL(file))
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${API_BASE}/club/logo`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Failed to upload logo')
      }
      refetch()
    } catch (err: any) {
      setError(err.message || 'Failed to upload logo')
      setLogoPreview(null)
    } finally {
      setUploadingLogo(false)
      if (logoInputRef.current) logoInputRef.current.value = ''
    }
  }

  const inputClass = "w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors text-sm"
  const labelClass = "block text-sm font-medium text-white/70 mb-1.5"

  const displayLogo = logoPreview || logoUrl

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Team Profile</h2>
        <p className="text-sm text-white/50 mt-1">Manage your team's identity and appearance</p>
      </div>

      {/* Team Logo */}
      <div>
        <label className={labelClass}>Team Logo</label>
        <div className="flex items-center gap-4">
          <div
            onClick={() => logoInputRef.current?.click()}
            className="relative w-16 h-16 rounded-xl border-2 border-dashed border-white/20 hover:border-emerald-500/50 flex items-center justify-center cursor-pointer transition-colors overflow-hidden group"
          >
            {displayLogo ? (
              <>
                <img src={displayLogo} alt="Club logo" className="w-full h-full object-contain p-1" onError={() => setLogoPreview(null)} />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera size={16} className="text-white" />
                </div>
              </>
            ) : (
              <Camera size={20} className="text-white/30 group-hover:text-emerald-400 transition-colors" />
            )}
            {uploadingLogo && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <Loader2 size={16} className="animate-spin text-white" />
              </div>
            )}
          </div>
          <div>
            <button
              onClick={() => logoInputRef.current?.click()}
              disabled={uploadingLogo}
              className="text-sm text-emerald-400 hover:text-emerald-300 font-medium transition-colors disabled:opacity-50"
            >
              {displayLogo ? 'Change logo' : 'Upload logo'}
            </button>
            <p className="text-xs text-white/40 mt-0.5">PNG, JPG, SVG, or WebP. Shown in the navbar.</p>
          </div>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            onChange={handleLogoUpload}
            className="hidden"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Team Name</label>
          <input className={inputClass} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className={labelClass}>Short Name</label>
          <input className={inputClass} value={form.short_name} onChange={e => setForm(f => ({ ...f, short_name: e.target.value }))} placeholder="e.g. Dungloe" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Alternative Team Names</label>
          <input className={inputClass} value={form.team_aliases} onChange={e => setForm(f => ({ ...f, team_aliases: e.target.value }))} placeholder="e.g. An Clochán Liath, CLG An Clochán Liath" />
          <p className="text-xs text-white/40 mt-1">Other names your team is known by, separated by commas (e.g. Irish name, abbreviations). Used to match your team in fixture files.</p>
        </div>
        <div>
          <label className={labelClass}>County</label>
          <input className={inputClass} value={form.county} onChange={e => setForm(f => ({ ...f, county: e.target.value }))} />
        </div>
        <div>
          <label className={labelClass}>Province</label>
          <select className={inputClass} value={form.province} onChange={e => setForm(f => ({ ...f, province: e.target.value }))}>
            <option value="">Select</option>
            <option value="Ulster">Ulster</option>
            <option value="Munster">Munster</option>
            <option value="Leinster">Leinster</option>
            <option value="Connacht">Connacht</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Home Ground</label>
          <input className={inputClass} value={form.home_ground} onChange={e => setForm(f => ({ ...f, home_ground: e.target.value }))} />
        </div>
        <div>
          <label className={labelClass}>Primary Colour</label>
          <div className="flex items-center gap-3">
            <input type="color" value={form.primary_colour} onChange={e => setForm(f => ({ ...f, primary_colour: e.target.value }))} className="w-10 h-10 rounded-lg border border-white/10 cursor-pointer bg-transparent" />
            <input className={inputClass} value={form.primary_colour} onChange={e => setForm(f => ({ ...f, primary_colour: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Secondary Colour</label>
          <div className="flex items-center gap-3">
            <input type="color" value={form.secondary_colour} onChange={e => setForm(f => ({ ...f, secondary_colour: e.target.value }))} className="w-10 h-10 rounded-lg border border-white/10 cursor-pointer bg-transparent" />
            <input className={inputClass} value={form.secondary_colour} onChange={e => setForm(f => ({ ...f, secondary_colour: e.target.value }))} />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {saved && <p className="text-sm text-emerald-400">Settings saved successfully</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
        style={{ background: 'var(--gradient-primary)', color: '#0a1a10', border: '1px solid rgba(0,230,118,0.3)', boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3)' }}
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        {saving ? 'Saving...' : 'Save Changes'}
      </button>

      <RosterImportSection />
    </div>
  )
}


function RosterImportSection() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<'idle' | 'pick-column' | 'preview' | 'importing' | 'done'>('idle')
  const [preview, setPreview] = useState<{ parsed_count: number; valid_count: number; warnings: string[]; rows: any[]; headers?: string[]; needs_name_column?: boolean } | null>(null)
  const [result, setResult] = useState<{ created: number; updated: number; unchanged: number; details: Array<{ name: string; action: string }> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedNameCol, setSelectedNameCol] = useState<string>('')

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setSelectedFile(file)
    try {
      const data = await playersAPI.previewImport(file)
      if (data.needs_name_column && data.headers?.length) {
        setPreview(data)
        setSelectedNameCol(data.headers[0])
        setStep('pick-column')
      } else {
        setPreview(data)
        setStep('preview')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to parse file')
      setStep('idle')
    }
  }

  const handleColumnSelected = async () => {
    if (!selectedFile || !selectedNameCol) return
    setError(null)
    try {
      const data = await playersAPI.previewImport(selectedFile, selectedNameCol)
      setPreview(data)
      setStep('preview')
    } catch (err: any) {
      setError(err.message || 'Failed to re-parse file')
    }
  }

  const handleConfirm = async () => {
    if (!preview) return
    setStep('importing')
    setError(null)
    try {
      const players = preview.rows
        .map((r: any) => ({
          name: r.name,
          position: r.position || undefined,
          jersey_number: r.jersey_number || undefined,
          date_of_birth: r.date_of_birth || undefined,
        }))
      const res = await playersAPI.confirmImport(players)
      setResult(res)
      setStep('done')
    } catch (err: any) {
      setError(err.message || 'Import failed')
      setStep('preview')
    }
  }

  const reset = () => {
    setStep('idle')
    setPreview(null)
    setResult(null)
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const actionIcon = (action: string) => {
    if (action === 'created') return <UserPlus size={12} className="text-emerald-400" />
    if (action === 'updated') return <RefreshCw size={12} className="text-amber-400" />
    return <Minus size={12} className="text-white/30" />
  }

  return (
    <div className="pt-6 mt-6 border-t border-white/10">
      <h2 className="text-lg font-semibold text-white">Roster Import</h2>
      <p className="text-sm text-white/50 mt-1 mb-4">
        Upload a CSV or XLSX file to update your squad. Existing players are matched by name — their match data, GPS, and stats are preserved. New players are added automatically.
      </p>

      {step === 'idle' && (
        <div>
          <input ref={fileRef} type="file" accept=".csv,.xlsx" onChange={handleFile} className="hidden" />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/80 hover:text-white text-sm font-medium transition-colors"
          >
            <Upload size={16} />
            Upload Roster File
          </button>
          <p className="text-xs text-white/30 mt-2">Supports columns: Name, Position, Jersey Number, Date of Birth</p>
        </div>
      )}

      {step === 'pick-column' && preview?.headers && (
        <div className="space-y-3">
          <p className="text-sm text-white/70">
            Couldn't auto-detect the name column. Which column contains player names?
          </p>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs text-white/50 mb-1">Name column</label>
              <select
                value={selectedNameCol}
                onChange={e => setSelectedNameCol(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
              >
                {preview.headers.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleColumnSelected}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{ background: 'var(--gradient-primary)', color: '#0a1a10' }}
            >
              Continue
            </button>
            <button onClick={reset} className="px-4 py-2 rounded-lg bg-white/10 text-white/60 hover:text-white text-sm transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-3">
          <div className="text-sm text-white/70">
            Found <span className="text-white font-medium">{preview.valid_count}</span> valid players
            {preview.warnings.length > 0 && (
              <span className="text-amber-400"> ({preview.warnings.length} warnings)</span>
            )}
          </div>

          {preview.warnings.length > 0 && (
            <div className="text-xs text-amber-400/80 space-y-0.5 max-h-20 overflow-y-auto">
              {preview.warnings.map((w, i) => <div key={i}>{w}</div>)}
            </div>
          )}

          <div className="max-h-48 overflow-y-auto rounded-lg border border-white/10">
            <table className="w-full text-xs">
              <thead className="bg-white/5 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-1.5 text-white/50 font-medium">Name</th>
                  <th className="text-left px-3 py-1.5 text-white/50 font-medium">Position</th>
                  <th className="text-left px-3 py-1.5 text-white/50 font-medium">#</th>
                  <th className="text-left px-3 py-1.5 text-white/50 font-medium">DOB</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r: any, i: number) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="px-3 py-1.5 text-white/90">{r.name}</td>
                    <td className="px-3 py-1.5 text-white/60">{r.position || '-'}</td>
                    <td className="px-3 py-1.5 text-white/60">{r.jersey_number || '-'}</td>
                    <td className="px-3 py-1.5 text-white/60">{r.date_of_birth || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            <button onClick={handleConfirm} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all" style={{ background: 'var(--gradient-primary)', color: '#0a1a10' }}>
              <Check size={14} />
              Import {preview.valid_count} Players
            </button>
            <button onClick={reset} className="px-4 py-2 rounded-lg bg-white/10 text-white/60 hover:text-white text-sm transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="flex items-center gap-2 text-white/60 text-sm">
          <Loader2 size={16} className="animate-spin" />
          Importing roster...
        </div>
      )}

      {step === 'done' && result && (
        <div className="space-y-3">
          <div className="flex gap-4 text-sm">
            <span className="text-emerald-400">{result.created} created</span>
            <span className="text-amber-400">{result.updated} updated</span>
            <span className="text-white/40">{result.unchanged} unchanged</span>
          </div>

          <div className="max-h-40 overflow-y-auto rounded-lg border border-white/10">
            <table className="w-full text-xs">
              <tbody>
                {result.details.map((d, i) => (
                  <tr key={i} className="border-t border-white/5 first:border-0">
                    <td className="px-3 py-1.5 text-white/80">{d.name}</td>
                    <td className="px-3 py-1.5 flex items-center gap-1.5">
                      {actionIcon(d.action)}
                      <span className={d.action === 'created' ? 'text-emerald-400' : d.action === 'updated' ? 'text-amber-400' : 'text-white/30'}>
                        {d.action}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={reset} className="px-4 py-2 rounded-lg bg-white/10 text-white/70 hover:text-white text-sm transition-colors">
            Done
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
    </div>
  )
}
