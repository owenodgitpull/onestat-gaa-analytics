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
  Bot,
  BarChart3,
  Info,
  Sparkles
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usePlayers } from '../hooks/usePlayers'
import api from '../services/api'
import LoadingSkeleton from '../components/LoadingSkeleton'
import ConfirmationModal from '../components/ConfirmationModal'
import { renderAnalysisText } from '../utils/renderAnalysisText'
import type { LeaderboardPlayer } from '../services/api'
import PeakPerformanceChart from '../components/charts/training/PeakPerformanceChart'
import SpeedZoneChart from '../components/charts/training/SpeedZoneChart'
import ReadinessTable from '../components/charts/training/ReadinessTable'
import MonotonyScatter from '../components/charts/training/MonotonyScatter'
import InsightAlertsPanel from '../components/InsightAlertsPanel'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

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
  ai_summary?: string | null
  ai_summary_generated_at?: string | null
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
  const res = await fetch(`${API_BASE}/attendance/sessions?limit=50`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch sessions')
  return res.json()
}

const fetchSessionDetail = async (id: string): Promise<SessionDetail> => {
  const res = await fetch(`${API_BASE}/attendance/sessions/${id}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch session')
  return res.json()
}

const createSession = async (data: Partial<TrainingSession>) => {
  const res = await fetch(`${API_BASE}/attendance/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  })
  if (!res.ok) throw new Error('Failed to create session')
  return res.json()
}

const deleteSession = async (id: string) => {
  const res = await fetch(`${API_BASE}/attendance/sessions/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to delete session')
}

const bulkAddAttendance = async (data: { session_id: string; records: Array<{ player_id: string; status: string }> }) => {
  const res = await fetch(`${API_BASE}/attendance/attendance/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  })
  if (!res.ok) throw new Error('Failed to add attendance')
  return res.json()
}

const updateAttendance = async ({ id, status }: { id: string; status: string }) => {
  const res = await fetch(`${API_BASE}/attendance/attendance/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ status })
  })
  if (!res.ok) throw new Error('Failed to update attendance')
  return res.json()
}

const fetchSessionGPS = async (sessionId: string): Promise<GPSPlayerData[]> => {
  const res = await fetch(`${API_BASE}/training/gps/session/${sessionId}`, { credentials: 'include' })
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
  const [location, setLocation] = useState('Home Grounds')
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
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                <Plus size={20} />
              </button>
            </div>
            {drills.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {drills.map((drill, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-600/20 text-emerald-300 text-sm"
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
  const [generatedSummary, setGeneratedSummary] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)

  // Auto-generate AI summary if session has GPS data but no summary yet
  useEffect(() => {
    if (!session?.id) return
    if (session.ai_summary || generatedSummary || summaryLoading) return

    setSummaryLoading(true)
    fetch(`${API_BASE}/training/sessions/${session.id}/generate-summary`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.summary) {
          setGeneratedSummary(data.summary)
          queryClient.invalidateQueries({ queryKey: ['session', session.id] })
        }
      })
      .catch(() => {})
      .finally(() => setSummaryLoading(false))
  }, [session?.id])

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

        {/* AI Summary */}
        {(session.ai_summary || generatedSummary || summaryLoading) && (
          <div className="mb-5 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot size={14} className="text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                {summaryLoading ? (
                  <div className="flex items-center gap-2 text-sm text-white/50">
                    <RefreshCw size={13} className="animate-spin" />
                    Generating session summary…
                  </div>
                ) : (
                  <div className="text-sm leading-relaxed">
                    {renderAnalysisText(session.ai_summary || generatedSummary || '')}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* GPS Summary Stats */}
        {gpsStats && (
          <>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
              <div className="p-3 rounded-xl bg-white/5 text-center">
                <div className="text-2xl font-bold text-white">{gpsStats.players}</div>
                <div className="text-xs text-white/60">Players</div>
              </div>
              <div className="p-3 rounded-xl bg-white/5 text-center">
                <div className="text-2xl font-bold text-emerald-400">{gpsStats.avgDistance.toLocaleString()}</div>
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
                <div className="text-2xl font-bold text-cyan-400">{gpsStats.avgSprints}</div>
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

// Training Player Leaderboard with metric toggle — uses aggregated data
function TrainingLeaderboard({ leaderboard, squadAverages }: { leaderboard: LeaderboardPlayer[]; squadAverages: Record<string, number> }) {
  const [metric, setMetric] = useState<string>('total_distance')

  const metrics = [
    { key: 'total_distance', label: 'Total Distance', avgField: 'avg_total_distance_m', getValue: (p: LeaderboardPlayer) => p.avg_total_distance_m ?? 0, format: (v: number) => Math.round(v).toLocaleString() + 'm' },
    { key: 'max_speed', label: 'Max Speed', avgField: 'avg_max_speed_ms', getValue: (p: LeaderboardPlayer) => p.avg_max_speed_ms ?? 0, format: (v: number) => v.toFixed(2) + ' m/s' },
    { key: 'hsr', label: 'HSR', avgField: 'avg_high_speed_running_m', getValue: (p: LeaderboardPlayer) => p.avg_high_speed_running_m ?? 0, format: (v: number) => Math.round(v).toLocaleString() + 'm' },
    { key: 'sprints', label: 'Sprints', avgField: 'avg_sprint_count', getValue: (p: LeaderboardPlayer) => p.avg_sprint_count ?? 0, format: (v: number) => v.toFixed(1) },
    { key: 'dsl', label: 'DSL', avgField: 'avg_dynamic_stress_load', getValue: (p: LeaderboardPlayer) => p.avg_dynamic_stress_load ?? 0, format: (v: number) => Math.round(v).toLocaleString() },
  ]

  const activeMetric = metrics.find(m => m.key === metric)!
  const sorted = [...leaderboard].sort((a, b) => activeMetric.getValue(b) - activeMetric.getValue(a))
  const squadAvg = squadAverages[activeMetric.avgField] || 0
  const hasData = sorted.some(p => activeMetric.getValue(p) > 0)

  return (
    <div className="glass-card p-6">
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <TrendingUp size={20} />
        Player Leaderboard
        <span className="text-xs text-white/40 font-normal ml-2">All Sessions</span>
      </h3>

      {/* Metric toggle */}
      <div className="flex flex-wrap gap-2 mb-4">
        {metrics.map(m => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              metric === m.key
                ? 'bg-emerald-600 text-white'
                : 'bg-white/10 text-white/60 hover:bg-white/20'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {!hasData && (
        <div className="text-center text-white/40 text-sm py-6">
          No {activeMetric.label.toLowerCase()} data recorded yet — check your GPS file includes this column
        </div>
      )}

      {/* Leaderboard rows */}
      <div className={`space-y-0.5 ${!hasData ? 'hidden' : ''}`}>
        {/* Header */}
        <div className="grid grid-cols-[2rem_1fr_5rem_5rem] gap-2 text-xs text-white/40 px-2 pb-2 border-b border-white/10">
          <span className="text-center">#</span>
          <span>Player</span>
          <span className="text-right">Avg</span>
          <span className="text-right">vs Avg</span>
        </div>

        {sorted.map((p, i) => {
          const value = activeMetric.getValue(p)
          const diff = value - squadAvg
          const diffPct = squadAvg > 0 ? ((diff / squadAvg) * 100) : 0

          return (
            <div
              key={p.player_id}
              className="relative grid grid-cols-[2rem_1fr_5rem_5rem] gap-2 items-center rounded-lg px-2 py-2.5 hover:bg-white/5 transition-colors"
            >
              {/* Rank */}
              <span className={`text-center text-sm font-bold ${
                i === 0 ? 'text-yellow-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-600' : 'text-white/30'
              }`}>
                {i + 1}
              </span>

              {/* Player name + sessions badge */}
              <span className={`text-sm truncate ${i < 3 ? 'text-white font-medium' : 'text-white/70'}`}>
                {p.player_name}
                <span className="ml-1.5 text-[10px] text-white/30 font-normal">({p.sessions_count}s)</span>
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
  const [kpiView, setKpiView] = useState<'last-session' | 'overview'>('last-session')
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<string | null>(null)
  const [aiSummaryGenerating, setAiSummaryGenerating] = useState(false)

  const { data: aiSummaryData } = useQuery({
    queryKey: ['training-ai-summary'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/training/ai-summary/latest`, { credentials: 'include' })
      return res.ok ? res.json() : null
    },
    staleTime: 30_000,
  })
  const aiSummary = aiSummaryData?.summary ? aiSummaryData : null

  const { data: sessions, isLoading, refetch } = useQuery({
    queryKey: ['sessions'],
    queryFn: fetchSessions
  })

  const { data: selectedSession } = useQuery({
    queryKey: ['session', selectedSessionId],
    queryFn: () => selectedSessionId ? fetchSessionDetail(selectedSessionId) : null,
    enabled: !!selectedSessionId
  })

  // Training overview (aggregated across all sessions)
  const { data: trainingOverview } = useQuery({
    queryKey: ['training-overview'],
    queryFn: () => api.analytics.getTrainingOverview(),
    staleTime: 60_000,
    placeholderData: (prev) => prev,  // keep previous data while refetching
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
        credentials: 'include',
        body: formData
      })
    } catch (error) {
      console.error('Failed to upload GPS file:', error)
    }
  }

  const handleCreateSession = async (data: any, gpsFile?: File) => {
    try {
      const session = await createMutation.mutateAsync(data)
      setAiSummaryGenerating(true)

      if (gpsFile && session?.id) {
        await uploadGpsFile(session.id, gpsFile)
        // GPS processing + AI analysis runs as a backend background task (~15-20s total)
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['sessions'] })
          queryClient.invalidateQueries({ queryKey: ['training-overview'] })
          queryClient.invalidateQueries({ queryKey: ['session-gps'] })
        }, 3000)
        // Refresh AI summary once backend has had time to generate it
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['training-ai-summary'] })
          setAiSummaryGenerating(false)
        }, 20_000)
      } else if (session?.id) {
        // No GPS — trigger AI summary generation directly (uses attendance data)
        fetch(`${API_BASE}/training/sessions/${session.id}/generate-summary`, {
          method: 'POST',
          credentials: 'include',
        })
          .then(res => res.ok ? res.json() : null)
          .then(() => queryClient.invalidateQueries({ queryKey: ['training-ai-summary'] }))
          .catch(() => {})
          .finally(() => setAiSummaryGenerating(false))
      }
    } catch (error) {
      console.error('Failed to create session:', error)
      setAiSummaryGenerating(false)
    }
  }

  const deleteMutation = useMutation({
    mutationFn: deleteSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['training-ai-summary'] })
    }
  })

  // Fetch GPS data for the latest session to show on home page
  const latestSessionId = sessions?.[0]?.id
  const { data: latestGPS } = useQuery({
    queryKey: ['session-gps', latestSessionId],
    queryFn: () => fetchSessionGPS(latestSessionId!),
    enabled: !!latestSessionId,
  })

  // Keep a stable reference to the last non-empty GPS stats
  // Prevents KPI cards from disappearing when a new session is created but GPS hasn't processed yet
  const [stableGPSStats, setStableGPSStats] = useState<typeof latestGPSStatsRaw>(null)

  const latestGPSStatsRaw = useMemo(() => {
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

  // Only update stable stats when we have real data (prevents flash on new session)
  useEffect(() => {
    if (latestGPSStatsRaw) setStableGPSStats(latestGPSStatsRaw)
  }, [latestGPSStatsRaw])

  const latestGPSStats = latestGPSStatsRaw || stableGPSStats

  const overviewKpis = trainingOverview?.overview_kpis

  if (isLoading) {
    return <LoadingSkeleton variant="list" />
  }

  // Parse squad availability for color coding
  const getAvailabilityColor = (avail: string) => {
    const match = avail.match(/^(\d+)\/(\d+)/)
    if (!match) return 'text-white'
    const pct = parseInt(match[1]) / parseInt(match[2]) * 100
    if (pct >= 80) return 'text-emerald-400'
    if (pct >= 60) return 'text-amber-400'
    return 'text-red-400'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center">
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
          <button onClick={() => refetch()} className="btn-glass p-2" title="Refresh">
            <RefreshCw size={16} />
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
      {(aiSummary?.summary || aiSummaryGenerating) && (
        <div className="glass-card p-4 border border-emerald-500/20">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              {aiSummaryGenerating
                ? <Sparkles size={16} className="text-emerald-400 animate-spin" />
                : <Bot size={16} className="text-emerald-400" />
              }
            </div>
            <div className="flex-1 min-w-0">
              {aiSummaryGenerating ? (
                <p className="text-sm text-white/50 italic">Generating AI training summary…</p>
              ) : (
                <>
                  <div className="text-sm leading-relaxed">{renderAnalysisText(aiSummary!.summary!)}</div>
                  {aiSummary!.session_date && (
                    <p className="text-xs text-white/40 mt-1">
                      {new Date(aiSummary!.session_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Insight Alerts */}
      <InsightAlertsPanel dashboard="training" />

      {/* KPI Cards with Toggle */}
      {(latestGPSStats || overviewKpis) && (
        <div className="space-y-4 relative z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Zap size={18} className="text-emerald-400" />
              {kpiView === 'last-session' ? 'Latest Session Overview' : 'Season Overview'}
            </h2>
            <div className="flex items-center gap-2">
              {kpiView === 'last-session' && sessions?.[0] && (
                <span className="text-xs text-white/40 mr-2">
                  {new Date(sessions[0].session_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              )}
              <div className="flex rounded-lg overflow-hidden border border-white/10">
                <button
                  onClick={() => setKpiView('last-session')}
                  className={`px-3 py-1.5 text-xs font-medium transition-all ${
                    kpiView === 'last-session'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white/10 text-white/60 hover:bg-white/20'
                  }`}
                >
                  Last Session
                </button>
                <button
                  onClick={() => setKpiView('overview')}
                  className={`px-3 py-1.5 text-xs font-medium transition-all ${
                    kpiView === 'overview'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white/10 text-white/60 hover:bg-white/20'
                  }`}
                >
                  Season Overview
                </button>
              </div>
            </div>
          </div>

          {kpiView === 'last-session' && latestGPSStats ? (
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              <div className="glass-card p-4 text-center">
                <div className="text-2xl font-bold text-white">{latestGPSStats.players}</div>
                <div className="text-xs text-white/60 mt-1">Players</div>
              </div>
              <div className="glass-card p-4 text-center">
                <div className="text-2xl font-bold text-emerald-400">{latestGPSStats.avgDistance.toLocaleString()}</div>
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
                <div className="text-2xl font-bold text-cyan-400">{latestGPSStats.avgSprints}</div>
                <div className="text-xs text-white/60 mt-1">Avg Sprints</div>
              </div>
              <div className="glass-card p-4 text-center">
                <div className="text-2xl font-bold text-red-400">{latestGPSStats.avgDSL}</div>
                <div className="text-xs text-white/60 mt-1">Avg DSL</div>
              </div>
            </div>
          ) : kpiView === 'overview' && overviewKpis ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* Squad Availability */}
              <div className="glass-card p-4 text-center relative group/tip overflow-visible">
                <button
                  className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center transition-colors z-10"
                >
                  <Info size={11} className="text-white/50" />
                </button>
                <div className="hidden group-hover/tip:block absolute top-9 right-2 bg-slate-900/95 border border-white/20 rounded-lg p-2.5 text-xs text-white/80 leading-relaxed z-30 w-52 shadow-xl backdrop-blur-sm text-left">
                  Players with a readiness score of 60% or higher are counted as fit. Readiness is based on training load consistency, step balance, and speed attainment.
                </div>
                <div className={`text-2xl font-bold ${getAvailabilityColor(overviewKpis.squad_availability)}`}>
                  {overviewKpis.squad_availability}
                </div>
                <div className="text-xs text-white/60 mt-1">Squad Availability</div>
                {overviewKpis.untracked_players > 0 && (
                  <div className="text-[10px] text-amber-400/70 mt-0.5">
                    {overviewKpis.untracked_players} with no GPS data
                  </div>
                )}
              </div>

              {/* Top Speed */}
              <div className="glass-card p-4 text-center relative group/tip overflow-visible">
                <button
                  className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center transition-colors z-10"
                >
                  <Info size={11} className="text-white/50" />
                </button>
                <div className="hidden group-hover/tip:block absolute top-9 right-2 bg-slate-900/95 border border-white/20 rounded-lg p-2.5 text-xs text-white/80 leading-relaxed z-30 w-48 shadow-xl backdrop-blur-sm text-left">
                  The fastest speed recorded by any player in training over the last 7 days.
                </div>
                <div className="text-2xl font-bold text-emerald-400">{overviewKpis.top_speed_value} m/s</div>
                <div className="text-xs text-white/60 mt-1">Top Speed (Week)</div>
                {overviewKpis.top_speed_player && (
                  <div className="text-[10px] text-white/40 mt-0.5">{overviewKpis.top_speed_player}</div>
                )}
              </div>

              {/* HMLD Density */}
              <div className="glass-card p-4 text-center relative group/tip overflow-visible">
                <button
                  className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center transition-colors z-10"
                >
                  <Info size={11} className="text-white/50" />
                </button>
                <div className="hidden group-hover/tip:block absolute top-9 right-2 bg-slate-900/95 border border-white/20 rounded-lg p-2.5 text-xs text-white/80 leading-relaxed z-30 w-52 shadow-xl backdrop-blur-sm text-left">
                  {overviewKpis.hmld_density != null
                    ? overviewKpis.hmld_is_estimate
                      ? "High-intensity metres per minute (estimated from HSR data). Upload CSVs with HML distance for exact values."
                      : "High Metabolic Load Distance per minute of training — measures intensity of effort across the session."
                    : "No HML or duration data available yet. Upload CSVs with HML distance and duration columns to see this metric."
                  }
                </div>
                <div className="text-2xl font-bold text-amber-400">
                  {overviewKpis.hmld_density != null
                    ? `${overviewKpis.hmld_density}${overviewKpis.hmld_is_estimate ? '*' : ''}`
                    : 'N/A'
                  }
                </div>
                <div className="text-xs text-white/60 mt-1">
                  {overviewKpis.hmld_is_estimate ? 'HSR Density (m/min)' : 'HMLD Density (m/min)'}
                </div>
                {overviewKpis.hmld_is_estimate && (
                  <div className="text-[10px] text-white/30 mt-0.5">*estimated from HSR</div>
                )}
              </div>

              {/* Team Balance */}
              <div className="glass-card p-4 text-center relative group/tip overflow-visible">
                <button
                  className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center transition-colors z-10"
                >
                  <Info size={11} className="text-white/50" />
                </button>
                <div className="hidden group-hover/tip:block absolute top-9 right-2 bg-slate-900/95 border border-white/20 rounded-lg p-2.5 text-xs text-white/80 leading-relaxed z-30 w-52 shadow-xl backdrop-blur-sm text-left">
                  Average left/right step balance across all players from the latest session. 50/50 is ideal — imbalance may indicate fatigue or injury risk.
                </div>
                <div className="text-2xl font-bold text-emerald-400">
                  {overviewKpis.team_balance_left_pct.toFixed(1)}% L
                </div>
                <div className="text-xs text-white/60 mt-1">Team Step Balance</div>
                <div className="text-[10px] text-white/40 mt-0.5">
                  {(100 - overviewKpis.team_balance_left_pct).toFixed(1)}% R — {Math.abs(overviewKpis.team_balance_left_pct - 50) < 3 ? 'balanced' : 'imbalanced'}
                </div>
              </div>
            </div>
          ) : (
            <div className="glass-card p-8 text-center text-white/40">
              No data available for this view
            </div>
          )}
        </div>
      )}

      {/* Player Leaderboard — aggregated across all sessions */}
      {trainingOverview && trainingOverview.leaderboard.length > 0 && (
        <TrainingLeaderboard
          leaderboard={trainingOverview.leaderboard}
          squadAverages={trainingOverview.squad_averages}
        />
      )}

      {/* Training Analytics Charts */}
      {trainingOverview && (
        trainingOverview.peak_performance.length > 0 ||
        trainingOverview.readiness.length > 0 ||
        trainingOverview.speed_zones.length > 0 ||
        trainingOverview.monotony.length > 0
      ) && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <BarChart3 size={18} className="text-emerald-400" />
            Training Analytics
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PeakPerformanceChart data={trainingOverview!.peak_performance} />
            <SpeedZoneChart data={trainingOverview!.speed_zones} />
            <ReadinessTable data={trainingOverview!.readiness} />
            <MonotonyScatter data={trainingOverview!.monotony} />
          </div>
        </div>
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
                    session.session_type === 'training' ? 'bg-emerald-600/20' :
                    session.session_type === 'gym' ? 'bg-orange-600/20' :
                    'bg-cyan-600/20'
                  }`}>
                    <Calendar size={24} className={`${
                      session.session_type === 'training' ? 'text-emerald-400' :
                      session.session_type === 'gym' ? 'text-orange-400' :
                      'text-cyan-400'
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
                      setDeleteSessionTarget(session.id)
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

      <ConfirmationModal
        isOpen={!!deleteSessionTarget}
        onClose={() => setDeleteSessionTarget(null)}
        onConfirm={() => {
          if (deleteSessionTarget) deleteMutation.mutate(deleteSessionTarget)
          setDeleteSessionTarget(null)
        }}
        title="Delete Session"
        message="Delete this training session? All attendance records for this session will be lost."
        confirmText="Delete"
        cancelText="Keep"
        variant="danger"
      />
    </div>
  )
}
