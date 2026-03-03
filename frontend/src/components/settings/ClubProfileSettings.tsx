import { useState, useEffect } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { useClub } from '../../contexts/ClubContext'
import { fetchAPI } from '../../services/api'

export default function ClubProfileSettings() {
  const { club, refetch } = useClub()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: '',
    short_name: '',
    county: '',
    province: '',
    home_ground: '',
    primary_colour: '#00e676',
    secondary_colour: '#ffffff',
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
      })
    }
  }, [club])

  const handleSave = async () => {
    if (!club) return
    setSaving(true)
    setError(null)
    setSaved(false)

    try {
      await fetchAPI(`/club/${club.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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

  const inputClass = "w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors text-sm"
  const labelClass = "block text-sm font-medium text-white/70 mb-1.5"

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Club Profile</h2>
        <p className="text-sm text-white/50 mt-1">Manage your club's identity and appearance</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Club Name</label>
          <input className={inputClass} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className={labelClass}>Short Name</label>
          <input className={inputClass} value={form.short_name} onChange={e => setForm(f => ({ ...f, short_name: e.target.value }))} placeholder="e.g. Dungloe" />
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
    </div>
  )
}
