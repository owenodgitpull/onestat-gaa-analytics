/**
 * Attendance Tracking Page
 * Manage training sessions and player attendance
 */

import { useState, useMemo, useEffect } from 'react'
import {
  Calendar,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  RefreshCw,
  ChevronRight,
  Trash2,
  Upload,
  Dumbbell,
  X,
  Zap,
  Activity,
  TrendingUp,
  Bot
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usePlayers } from '../hooks/usePlayers'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8001/api/v1'

// Types
interface TrainingSession {
  id: string
  session_date: string
  session_type: 'training' | 'match' | 'gym' | 'recovery'
  start_time: string | null
  end_time: string | null
  location: string | null
  notes: string | null
  created_at: string
  attendance_count: number
  present_count: number
}

interface AttendanceRecord {
  id: string
  session_id: string
  player_id: string
  player_name: string | null
  status: 'present' | 'absent' | 'late' | 'excused' | 'injured'
  arrival_time: string | null
  notes: string | null
  created_at: string
}

interface SessionDetail extends TrainingSession {
  attendance_records: AttendanceRecord[]
}

interface GPSPlayerData {
  id: string
  player_name: string | null
  total_distance_m: number | null
  high_speed_running_m: number | null
  sprint_distance_m: number | null
  max_speed_ms: number | null
  sprint_count: number | null
  acceleration_count: number | null
  deceleration_count: number | null
  dynamic_stress_load: number | null
  player_load: number | null
  avg_heart_rate: number | null
  max_heart_rate: number | null
}

// API functions
const fetchSessions = async (): Promise<TrainingSession[]> => {
  const res = await fetch(`${API_BASE}/attendance/sessions?limit=50`)
  if (!res.ok) throw new Error('Failed to fetch sessions')
  return res.json()
}

const fetchSessionDetail = async (id: string): Promise<SessionDetail> => {
  const res = await fetch(`${API_BASE}/attendance/sessions/${id}`)
  if (!res.ok) throw new Error('Failed to fetch session')
  return res.json()
}

const createSession = async (data: Partial<TrainingSession>) => {
  const res = await fetch(`${API_BASE}/attendance/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  if (!res.ok) throw new Error('Failed to create session')
  return res.json()
}

const deleteSession = async (id: string) => {
  const res = await fetch(`${API_BASE}/attendance/sessions/${id}`, {
    method: 'DELETE'
  })
  if (!res.ok) throw new Error('Failed to delete session')
}

const bulkAddAttendance = async (data: { session_id: string; records: Array<{ player_id: string; status: string }> }) => {
  const res = await fetch(`${API_BASE}/attendance/attendance/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  if (!res.ok) throw new Error('Failed to add attendance')
  return res.json()
}

const updateAttendance = async ({ id, status }: { id: string; status: string }) => {
  const res = await fetch(`${API_BASE}/attendance/attendance/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  })
  if (!res.ok) throw new Error('Failed to update attendance')
  return res.json()
}

const fetchSessionGPS = async (sessionId: string): Promise<GPSPlayerData[]> => {
  const res = await fetch(`${API_BASE}/training/gps/session/${sessionId}`)
  if (!res.ok) return []
  return res.json()
}

// Status badge component
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    present: 'bg-emerald-500/20 text-emerald-400',
    absent: 'bg-red-500/20 text-red-400',
    late: 'bg-amber-500/20 text-amber-400',
    excused: 'bg-blue-500/20 text-blue-400',
    injured: 'bg-purple-500/20 text-purple-400'
  }

  const icons: Record<string, React.ReactNode> = {
    present: <CheckCircle2 size={14} />,
    absent: <XCircle size={14} />,
    late: <Clock size={14} />,
    excused: <AlertCircle size={14} />,
    injured: <AlertCircle size={14} />
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${styles[status] || 'bg-slate-500/20 text-slate-400'}`}>
      {icons[status]}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

// New Session Modal
function NewSessionModal({ isOpen, onClose, onCreate }: {
  isOpen: boolean
  onClose: () => void
  onCreate: (data: any, gpsFile?: File) => void
}) {
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0])
  const [sessionType, setSessionType] = useState<'training' | 'gym' | 'recovery'>('training')
  const [startTime, setStartTime] = useState('19:00')
  const [location, setLocation] = useState('Dungloe GAA Grounds')
  const [drills, setDrills] = useState<string[]>([])
  const [newDrill, setNewDrill] = useState('')
  const [gpsFile, setGpsFile] = useState<File | null>(null)
  const [notes, setNotes] = useState('')

  const handleAddDrill = () => {
    if (newDrill.trim()) {
      setDrills([...drills, newDrill.trim()])
      setNewDrill('')
    }
  }

  const handleRemoveDrill = (index: number) => {
    setDrills(drills.filter((_, i) => i !== index))
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setGpsFile(e.target.files[0])
    }
  }

  const handleCreate = () => {
    const drillsText = drills.length > 0 ? `Drills: ${drills.join(', ')}` : ''
    const fullNotes = [notes, drillsText].filter(Boolean).join('\n\n')

    onCreate({
      session_date: sessionDate,
      session_type: sessionType,
      start_time: startTime,
      location,
      notes: fullNotes || null
    }, gpsFile || undefined)

    // Reset form
    setDrills([])
    setNewDrill('')
    setGpsFile(null)
    setNotes('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm overflow-y-auto py-8">
      <div className="glass-card p-6 w-full max-w-lg mx-4">
        <h2 className="text-xl font-bold text-white mb-4">New Training Session</h2>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          {/* Date & Type Row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/60 mb-1">Date</label>
              <input
                type="date"
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
                className="w-full px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-white/60 mb-1">Type</label>
              <select
                value={sessionType}
                onChange={(e) => setSessionType(e.target.value as any)}
                className="w-full px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white"
              >
                <option value="training" className="bg-slate-800">Training</option>
                <option value="gym" className="bg-slate-800">Gym</option>
                <option value="recovery" className="bg-slate-800">Recovery</option>
              </select>
            </div>
          </div>

          {/* Time & Location Row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/60 mb-1">Start Time</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-white/60 mb-1">Location</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white"
              />
            </div>
          </div>

          {/* Drills Section */}
          <div>
            <label className="block text-sm text-white/60 mb-1 flex items-center gap-2">
              <Dumbbell size={14} />
              Drills
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={newDrill}
                onChange={(e) => setNewDrill(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddDrill()}
                placeholder="Enter drill name..."
                className="flex-1 px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40"
              />
              <button
                onClick={handleAddDrill}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
              >
                <Plus size={20} />
              </button>
            </div>
            {drills.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {drills.map((drill, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-indigo-600/20 text-indigo-300 text-sm"
                  >
                    {drill}
                    <button
                      onClick={() => handleRemoveDrill(index)}
                      className="hover:text-red-400 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* STATSports Upload */}
          <div>
            <label className="block text-sm text-white/60 mb-1 flex items-center gap-2">
              <Upload size={14} />
              STATSports Data (Optional)
            </label>
            <div className="relative">
              <input
                type="file"
                accept=".pdf,.csv"
                onChange={handleFileChange}
                className="hidden"
                id="gps-upload"
              />
              <label
                htmlFor="gps-upload"
                className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-white/5 border border-dashed border-white/20 text-white/60 hover:bg-white/10 hover:border-white/40 cursor-pointer transition-all"
              >
                <Upload size={20} />
                {gpsFile ? (
                  <span className="text-emerald-400">{gpsFile.name}</span>
                ) : (
                  <span>Upload PDF or CSV file</span>
                )}
              </label>
              {gpsFile && (
                <button
                  onClick={() => setGpsFile(null)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-red-400"
                >
                  <X size={18} />
                </button>
              )}
            </div>
            <p className="text-xs text-white/40 mt-1">
              GPS data will be processed after session creation
            </p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm text-white/60 mb-1">Notes (Optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Session notes, focus areas, etc..."
              rows={2}
              className="w-full px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 resize-none"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 btn-glass">
            Cancel
          </button>
          <button onClick={handleCreate} className="flex-1 btn-primary">
            Create Session
          </button>
        </div>
      </div>
    </div>
  )
}

// Session Detail Modal
function SessionDetailModal({ session, onClose }: {
  session: SessionDetail | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { data: players } = usePlayers()
  const [isRecording, setIsRecording] = useState(false)
  const [attendance, setAttendance] = useState<Record<string, string>>({})
  const [showAttendance, setShowAttendance] = useState(false)

  // Fetch GPS data for this session
  const { data: gpsData } = useQuery({
    queryKey: ['session-gps', session?.id],
    queryFn: () => fetchSessionGPS(session!.id),
    enabled: !!session?.id
  })

  const bulkMutation = useMutation({
    mutationFn: bulkAddAttendance,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['session', session?.id] })
      setIsRecording(false)
      setAttendance({})
    }
  })

  const updateMutation = useMutation({
    mutationFn: updateAttendance,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session', session?.id] })
    }
  })

  if (!session) return null

  const recordedPlayerIds = new Set(session.attendance_records.map(r => r.player_id))
  const unrecordedPlayers = players?.filter(p => !recordedPlayerIds.has(p.id)) || []

  const handleSaveAttendance = () => {
    const records = Object.entries(attendance).map(([player_id, status]) => ({
      player_id,
      status
    }))
    if (records.length > 0) {
      bulkMutation.mutate({ session_id: session.id, records })
    }
  }

  // GPS summary stats
  const hasGPS = gpsData && gpsData.length > 0
  const gpsStats = hasGPS ? {
    players: gpsData.length,
    avgDistance: Math.round(gpsData.reduce((s, p) => s + (p.total_distance_m || 0), 0) / gpsData.length),
    avgMaxSpeed: (gpsData.reduce((s, p) => s + (p.max_speed_ms || 0), 0) / gpsData.length).toFixed(2),
    avgHSR: Math.round(gpsData.reduce((s, p) => s + (p.high_speed_running_m || 0), 0) / gpsData.length),
    avgSprints: Math.round(gpsData.reduce((s, p) => s + (p.sprint_count || 0), 0) / gpsData.length),
    avgDSL: Math.round(gpsData.reduce((s, p) => s + (p.dynamic_stress_load || 0), 0) / gpsData.length),
  } : null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm overflow-y-auto py-8">
      <div className="glass-card p-6 w-full max-w-4xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-white">
              {session.session_type.charAt(0).toUpperCase() + session.session_type.slice(1)} Session
            </h2>
            <p className="text-white/60 text-sm">
              {new Date(session.session_date).toLocaleDateString('en-GB')} - {new Date(session.session_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <XCircle size={24} />
          </button>
        </div>

        {/* GPS Summary Stats */}
        {gpsStats && (
          <>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
              <div className="p-3 rounded-xl bg-white/5 text-center">
                <div className="text-2xl font-bold text-white">{gpsStats.players}</div>
                <div className="text-xs text-white/60">Players</div>
              </div>
              <div className="p-3 rounded-xl bg-white/5 text-center">
                <div className="text-2xl font-bold text-indigo-400">{gpsStats.avgDistance.toLocaleString()}</div>
                <div className="text-xs text-white/60">Avg Distance (m)</div>
              </div>
              <div className="p-3 rounded-xl bg-white/5 text-center">
                <div className="text-2xl font-bold text-emerald-400">{gpsStats.avgMaxSpeed}</div>
                <div className="text-xs text-white/60">Avg Max Speed (m/s)</div>
              </div>
              <div className="p-3 rounded-xl bg-white/5 text-center">
                <div className="text-2xl font-bold text-amber-400">{gpsStats.avgHSR}</div>
                <div className="text-xs text-white/60">Avg HSR (m)</div>
              </div>
              <div className="p-3 rounded-xl bg-white/5 text-center">
                <div className="text-2xl font-bold text-purple-400">{gpsStats.avgSprints}</div>
                <div className="text-xs text-white/60">Avg Sprints</div>
              </div>
              <div className="p-3 rounded-xl bg-white/5 text-center">
                <div className="text-2xl font-bold text-red-400">{gpsStats.avgDSL}</div>
                <div className="text-xs text-white/60">Avg DSL</div>
              </div>
            </div>

            {/* Player Data Table */}
            <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
              <Activity size={18} />
              Player Data
            </h3>
            <div className="overflow-x-auto mb-6 rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-white/10">
                    <th className="text-left p-3 text-white font-semibold">Player</th>
                    <th className="text-right p-3 text-white font-semibold">Distance (m)</th>
                    <th className="text-right p-3 text-white font-semibold">Max Speed (m/s)</th>
                    <th className="text-right p-3 text-white font-semibold">HSR (m)</th>
                    <th className="text-right p-3 text-white font-semibold">Sprints</th>
                    <th className="text-right p-3 text-white font-semibold">Accel</th>
                    <th className="text-right p-3 text-white font-semibold">Decel</th>
                    <th className="text-right p-3 text-white font-semibold">DSL</th>
                  </tr>
                </thead>
                <tbody>
                  {gpsData!.sort((a, b) => (b.total_distance_m || 0) - (a.total_distance_m || 0)).map((p, i) => (
                    <tr key={p.id} className={`border-t border-white/5 ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                      <td className="p-3 text-white font-medium">{p.player_name || 'Unknown'}</td>
                      <td className="p-3 text-right text-white/80">{p.total_distance_m ? Math.round(p.total_distance_m).toLocaleString() : '-'}</td>
                      <td className="p-3 text-right text-white/80">{p.max_speed_ms?.toFixed(2) || '-'}</td>
                      <td className="p-3 text-right text-white/80">{p.high_speed_running_m ? Math.round(p.high_speed_running_m) : '-'}</td>
                      <td className="p-3 text-right text-white/80">{p.sprint_count ?? '-'}</td>
                      <td className="p-3 text-right text-white/80">{p.acceleration_count ?? '-'}</td>
                      <td className="p-3 text-right text-white/80">{p.deceleration_count ?? '-'}</td>
                      <td className="p-3 text-right text-white/80">{p.dynamic_stress_load ? Math.round(p.dynamic_stress_load) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Attendance Toggle */}
        <button
          onClick={() => setShowAttendance(!showAttendance)}
          className="w-full mb-4 btn-glass flex items-center justify-center gap-2 text-sm"
        >
          <CheckCircle2 size={16} />
          {showAttendance ? 'Hide' : 'Show'} Attendance ({session.present_count}/{session.attendance_count})
        </button>

        {showAttendance && (
          <>
            {/* Record New Attendance */}
            {isRecording ? (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-white mb-3">Record Attendance</h3>
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {unrecordedPlayers.map(player => (
                    <div key={player.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                      <span className="text-white">{player.name}</span>
                      <div className="flex gap-2">
                        {['present', 'absent'].map(status => (
                          <button
                            key={status}
                            onClick={() => setAttendance(prev => ({ ...prev, [player.id]: status }))}
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                              attendance[player.id] === status
                                ? status === 'present' ? 'bg-emerald-600 text-white' :
                                  'bg-red-600 text-white'
                                : 'bg-white/10 text-white/60 hover:bg-white/20'
                            }`}
                          >
                            {status.charAt(0).toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 mt-4">
                  <button onClick={() => setIsRecording(false)} className="flex-1 btn-glass">
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveAttendance}
                    disabled={Object.keys(attendance).length === 0 || bulkMutation.isPending}
                    className="flex-1 btn-primary disabled:opacity-50"
                  >
                    {bulkMutation.isPending ? 'Saving...' : 'Save Attendance'}
                  </button>
                </div>
              </div>
            ) : (
              unrecordedPlayers.length > 0 && (
                <button
                  onClick={() => {
                    const defaults: Record<string, string> = {}
                    unrecordedPlayers.forEach(p => { defaults[p.id] = 'present' })
                    setAttendance(defaults)
                    setIsRecording(true)
                  }}
                  className="w-full mb-4 btn-glass flex items-center justify-center gap-2"
                >
                  <Plus size={20} />
                  Record Attendance ({unrecordedPlayers.length} players remaining)
                </button>
              )
            )}

            {/* Existing Records */}
            {session.attendance_records.length > 0 ? (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {session.attendance_records.map(record => (
                  <div key={record.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                    <span className="text-white">{record.player_name || 'Unknown'}</span>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={record.status} />
                      <select
                        value={record.status}
                        onChange={(e) => updateMutation.mutate({ id: record.id, status: e.target.value })}
                        className="px-2 py-1 rounded bg-white/10 text-white text-sm border-0"
                      >
                        <option value="present">Present</option>
                        <option value="absent">Absent</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-white/40 py-4">
                No attendance recorded yet
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Training Player Leaderboard with metric toggle
function TrainingLeaderboard({ gpsData }: { gpsData: GPSPlayerData[] }) {
  const [metric, setMetric] = useState<string>('total_distance')

  const metrics = [
    { key: 'total_distance', label: 'Total Distance', unit: 'm', getValue: (p: GPSPlayerData) => p.total_distance_m || 0, format: (v: number) => Math.round(v).toLocaleString() },
    { key: 'max_speed', label: 'Max Speed', unit: 'm/s', getValue: (p: GPSPlayerData) => p.max_speed_ms || 0, format: (v: number) => v.toFixed(2) },
    { key: 'hsr', label: 'HSR', unit: 'm', getValue: (p: GPSPlayerData) => p.high_speed_running_m || 0, format: (v: number) => Math.round(v).toLocaleString() },
    { key: 'sprints', label: 'Sprints', unit: '', getValue: (p: GPSPlayerData) => p.sprint_count || 0, format: (v: number) => Math.round(v).toString() },
    { key: 'dsl', label: 'DSL', unit: '', getValue: (p: GPSPlayerData) => p.dynamic_stress_load || 0, format: (v: number) => Math.round(v).toLocaleString() },
  ]

  const activeMetric = metrics.find(m => m.key === metric)!
  const sorted = [...gpsData].sort((a, b) => activeMetric.getValue(b) - activeMetric.getValue(a))
  const squadAvg = gpsData.reduce((s, p) => s + activeMetric.getValue(p), 0) / gpsData.length

  return (
    <div className="glass-card p-6">
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <TrendingUp size={20} />
        Player Leaderboard
      </h3>

      {/* Metric toggle */}
      <div className="flex flex-wrap gap-2 mb-4">
        {metrics.map(m => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              metric === m.key
                ? 'bg-indigo-600 text-white'
                : 'bg-white/10 text-white/60 hover:bg-white/20'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Leaderboard rows */}
      <div className="space-y-0.5">
        {/* Header */}
        <div className="grid grid-cols-[2rem_1fr_5rem_5rem] gap-2 text-xs text-white/40 px-2 pb-2 border-b border-white/10">
          <span className="text-center">#</span>
          <span>Player</span>
          <span className="text-right">Value</span>
          <span className="text-right">vs Avg</span>
        </div>

        {sorted.map((p, i) => {
          const value = activeMetric.getValue(p)
          const diff = value - squadAvg
          const diffPct = squadAvg > 0 ? ((diff / squadAvg) * 100) : 0

          return (
            <div
              key={p.id}
              className="relative grid grid-cols-[2rem_1fr_5rem_5rem] gap-2 items-center rounded-lg px-2 py-2.5 hover:bg-white/5 transition-colors"
            >
              {/* Rank */}
              <span className={`text-center text-sm font-bold ${
                i === 0 ? 'text-yellow-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-600' : 'text-white/30'
              }`}>
                {i + 1}
              </span>

              {/* Player name */}
              <span className={`text-sm truncate ${i < 3 ? 'text-white font-medium' : 'text-white/70'}`}>
                {p.player_name || 'Unknown'}
              </span>

              {/* Value */}
              <span className="text-right text-sm text-white/80 font-mono">
                {activeMetric.format(value)}
              </span>

              {/* vs Squad Avg */}
              <span className={`text-right text-xs font-medium ${
                diff >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {diff >= 0 ? '+' : ''}{Math.round(diffPct)}%
              </span>
            </div>
          )
        })}
      </div>

      {/* Squad avg footer */}
      <div className="grid grid-cols-[2rem_1fr_5rem_5rem] gap-2 text-xs text-white/40 px-2 pt-2 mt-1 border-t border-white/10">
        <span />
        <span className="font-medium">Squad Average</span>
        <span className="text-right font-mono">{activeMetric.format(squadAvg)}</span>
        <span />
      </div>
    </div>
  )
}

export default function Attendance() {
  const queryClient = useQueryClient()
  const [showNewSession, setShowNewSession] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [aiSummary, setAiSummary] = useState<{ summary: string | null; session_date: string | null } | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/training/ai-summary/latest`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.summary) setAiSummary(data) })
      .catch(() => {})
  }, [])

  const { data: sessions, isLoading, refetch } = useQuery({
    queryKey: ['sessions'],
    queryFn: fetchSessions
  })

  const { data: selectedSession } = useQuery({
    queryKey: ['session', selectedSessionId],
    queryFn: () => selectedSessionId ? fetchSessionDetail(selectedSessionId) : null,
    enabled: !!selectedSessionId
  })

  const createMutation = useMutation({
    mutationFn: createSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    }
  })

  // Function to upload GPS file after session creation
  const uploadGpsFile = async (sessionId: string, file: File) => {
    const formData = new FormData()
    formData.append('session_id', sessionId)
    formData.append('file', file)

    try {
      await fetch(`${API_BASE}/training/gps/upload`, {
        method: 'POST',
        body: formData
      })
    } catch (error) {
      console.error('Failed to upload GPS file:', error)
    }
  }

  const handleCreateSession = async (data: any, gpsFile?: File) => {
    try {
      const session = await createMutation.mutateAsync(data)
      if (gpsFile && session?.id) {
        await uploadGpsFile(session.id, gpsFile)
      }
    } catch (error) {
      console.error('Failed to create session:', error)
    }
  }

  const deleteMutation = useMutation({
    mutationFn: deleteSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    }
  })

  // Fetch GPS data for the latest session to show on home page
  const latestSessionId = sessions?.[0]?.id
  const { data: latestGPS } = useQuery({
    queryKey: ['session-gps', latestSessionId],
    queryFn: () => fetchSessionGPS(latestSessionId!),
    enabled: !!latestSessionId
  })

  const latestGPSStats = useMemo(() => {
    if (!latestGPS || latestGPS.length === 0) return null
    const n = latestGPS.length
    return {
      players: n,
      avgDistance: Math.round(latestGPS.reduce((s, p) => s + (p.total_distance_m || 0), 0) / n),
      avgMaxSpeed: (latestGPS.reduce((s, p) => s + (p.max_speed_ms || 0), 0) / n).toFixed(2),
      avgHSR: Math.round(latestGPS.reduce((s, p) => s + (p.high_speed_running_m || 0), 0) / n),
      avgSprints: Math.round(latestGPS.reduce((s, p) => s + (p.sprint_count || 0), 0) / n),
      avgDSL: Math.round(latestGPS.reduce((s, p) => s + (p.dynamic_stress_load || 0), 0) / n),
    }
  }, [latestGPS])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-indigo-400" size={48} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-600 to-cyan-600 flex items-center justify-center">
            <Dumbbell size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Training</h1>
            <p className="text-white/60 text-sm">
              {sessions?.length || 0} session{sessions?.length !== 1 ? 's' : ''} recorded
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => refetch()} className="btn-glass flex items-center gap-2">
            <RefreshCw size={16} />
            Refresh
          </button>
          <button
            onClick={() => setShowNewSession(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={20} />
            New Session
          </button>
        </div>
      </div>

      {/* AI Training Insight */}
      {aiSummary?.summary && (
        <div className="glass-card p-4 border border-indigo-500/20">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
              <Bot size={16} className="text-indigo-400" />
            </div>
            <div>
              <p className="text-sm text-white/80 leading-relaxed">{aiSummary.summary}</p>
              {aiSummary.session_date && (
                <p className="text-xs text-white/40 mt-1">
                  {new Date(aiSummary.session_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Latest Session GPS Stats */}
      {latestGPSStats && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Zap size={18} className="text-indigo-400" />
              Latest Session Overview
            </h2>
            <span className="text-xs text-white/40">
              {sessions?.[0] && new Date(sessions[0].session_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>

          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <div className="glass-card p-4 text-center">
              <div className="text-2xl font-bold text-white">{latestGPSStats.players}</div>
              <div className="text-xs text-white/60 mt-1">Players</div>
            </div>
            <div className="glass-card p-4 text-center">
              <div className="text-2xl font-bold text-indigo-400">{latestGPSStats.avgDistance.toLocaleString()}</div>
              <div className="text-xs text-white/60 mt-1">Avg Distance (m)</div>
            </div>
            <div className="glass-card p-4 text-center">
              <div className="text-2xl font-bold text-emerald-400">{latestGPSStats.avgMaxSpeed}</div>
              <div className="text-xs text-white/60 mt-1">Avg Max Speed (m/s)</div>
            </div>
            <div className="glass-card p-4 text-center">
              <div className="text-2xl font-bold text-amber-400">{latestGPSStats.avgHSR}</div>
              <div className="text-xs text-white/60 mt-1">Avg HSR (m)</div>
            </div>
            <div className="glass-card p-4 text-center">
              <div className="text-2xl font-bold text-purple-400">{latestGPSStats.avgSprints}</div>
              <div className="text-xs text-white/60 mt-1">Avg Sprints</div>
            </div>
            <div className="glass-card p-4 text-center">
              <div className="text-2xl font-bold text-red-400">{latestGPSStats.avgDSL}</div>
              <div className="text-xs text-white/60 mt-1">Avg DSL</div>
            </div>
          </div>
        </div>
      )}

      {/* Player Leaderboard */}
      {latestGPS && latestGPS.length > 0 && (
        <TrainingLeaderboard gpsData={latestGPS} />
      )}

      {/* Sessions List */}
      {sessions && sessions.length > 0 ? (
        <div className="space-y-3">
          {sessions.map(session => (
            <div
              key={session.id}
              className="glass-card p-4 hover:bg-white/10 transition-all cursor-pointer group"
              onClick={() => setSelectedSessionId(session.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                    session.session_type === 'training' ? 'bg-indigo-600/20' :
                    session.session_type === 'gym' ? 'bg-orange-600/20' :
                    'bg-teal-600/20'
                  }`}>
                    <Calendar size={24} className={`${
                      session.session_type === 'training' ? 'text-indigo-400' :
                      session.session_type === 'gym' ? 'text-orange-400' :
                      'text-teal-400'
                    }`} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">
                      {session.session_type.charAt(0).toUpperCase() + session.session_type.slice(1)} Session
                    </h3>
                    <p className="text-sm text-white/60">
                      {new Date(session.session_date).toLocaleDateString()} • {session.start_time || 'Time TBD'}
                    </p>
                    {session.location && (
                      <p className="text-xs text-white/40">{session.location}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-4">
                  <div className="text-right">
                    <div className="text-lg font-bold text-white">
                      {session.present_count}/{session.attendance_count}
                    </div>
                    <div className="text-xs text-white/60">Present</div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm('Delete this session?')) {
                        deleteMutation.mutate(session.id)
                      }
                    }}
                    className="p-2 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={18} />
                  </button>
                  <ChevronRight size={20} className="text-white/40 group-hover:text-white transition-colors" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass-card p-12 text-center">
          <Calendar size={48} className="mx-auto text-white/20 mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">No Sessions Yet</h3>
          <p className="text-white/60 mb-6">
            Create your first training session to start tracking attendance
          </p>
          <button
            onClick={() => setShowNewSession(true)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus size={20} />
            Create Session
          </button>
        </div>
      )}

      {/* Modals */}
      <NewSessionModal
        isOpen={showNewSession}
        onClose={() => setShowNewSession(false)}
        onCreate={handleCreateSession}
      />

      <SessionDetailModal
        session={selectedSession || null}
        onClose={() => setSelectedSessionId(null)}
      />
    </div>
  )
}
