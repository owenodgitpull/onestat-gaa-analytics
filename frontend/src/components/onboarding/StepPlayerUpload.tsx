/**
 * StepPlayerUpload
 * Two tabs: "Upload File" and "Manual Entry".
 * Upload parses CSV/XLSX via API preview endpoint.
 * Manual entry adds one player at a time.
 * Both merge into a combined preview table.
 */

import { useState, useRef, useCallback } from 'react';
import { Upload, Plus, Trash2, AlertTriangle, FileSpreadsheet, UserPlus } from 'lucide-react';
import api from '../../services/api';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PlayerPreviewRow {
  name: string;
  position?: string;
  jersey_number?: number;
  date_of_birth?: string;
  warnings?: string[];
}

export interface ManualPlayer {
  name: string;
  position: string;
  jersey_number: string;
  date_of_birth: string;
}

interface StepPlayerUploadProps {
  clubId: string | null;
  preview: PlayerPreviewRow[];
  onPreviewChange: (rows: PlayerPreviewRow[]) => void;
  manualPlayers: ManualPlayer[];
  onManualPlayersChange: (players: ManualPlayer[]) => void;
}

const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];

const EMPTY_MANUAL: ManualPlayer = {
  name: '',
  position: '',
  jersey_number: '',
  date_of_birth: '',
};

// ── Component ──────────────────────────────────────────────────────────────

export default function StepPlayerUpload({
  clubId,
  preview,
  onPreviewChange,
  manualPlayers,
  onManualPlayersChange,
}: StepPlayerUploadProps) {
  const [activeTab, setActiveTab] = useState<'upload' | 'manual'>('upload');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [form, setForm] = useState<ManualPlayer>({ ...EMPTY_MANUAL });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File Upload ────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    if (!clubId) {
      setUploadError('Please complete club setup first (steps 1-2).');
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(ext || '')) {
      setUploadError('Please upload a CSV or Excel file.');
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const result = await api.onboarding.previewPlayers(clubId, file);
      onPreviewChange(result.rows || []);
    } catch (err: any) {
      setUploadError(err.message || 'Failed to parse file.');
    } finally {
      setUploading(false);
    }
  }, [clubId, onPreviewChange]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  // ── Manual Entry ───────────────────────────────────────────────────

  const addManualPlayer = () => {
    if (!form.name.trim()) return;
    onManualPlayersChange([...manualPlayers, { ...form }]);
    setForm({ ...EMPTY_MANUAL });
  };

  const removeManualPlayer = (idx: number) => {
    onManualPlayersChange(manualPlayers.filter((_, i) => i !== idx));
  };

  // ── Combined preview ──────────────────────────────────────────────

  const allPlayers: PlayerPreviewRow[] = [
    ...preview,
    ...manualPlayers.map((p) => ({
      name: p.name,
      position: p.position || undefined,
      jersey_number: p.jersey_number ? parseInt(p.jersey_number, 10) : undefined,
      date_of_birth: p.date_of_birth || undefined,
    })),
  ];

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Add Players</h2>
        <p className="text-white/50 text-sm">
          Upload a spreadsheet or add players manually. You can always edit later.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('upload')}
          className={`
            flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
            ${activeTab === 'upload'
              ? 'bg-emerald-500/20 border border-emerald-400/30 text-white'
              : 'bg-white/5 border border-white/10 text-white/50 hover:text-white/70 hover:bg-white/8'
            }
          `}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Upload File
        </button>
        <button
          onClick={() => setActiveTab('manual')}
          className={`
            flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
            ${activeTab === 'manual'
              ? 'bg-emerald-500/20 border border-emerald-400/30 text-white'
              : 'bg-white/5 border border-white/10 text-white/50 hover:text-white/70 hover:bg-white/8'
            }
          `}
        >
          <UserPlus className="w-4 h-4" />
          Manual Entry
        </button>
      </div>

      {/* Upload Tab */}
      {activeTab === 'upload' && (
        <div className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              glass-card p-10 flex flex-col items-center gap-4 cursor-pointer
              transition-all duration-300 group
              ${dragOver
                ? 'border-emerald-400/50 bg-emerald-500/10'
                : 'hover:border-emerald-400/30'
              }
            `}
          >
            <div
              className={`
                w-14 h-14 rounded-full flex items-center justify-center transition-colors duration-300
                ${dragOver ? 'bg-emerald-500/30' : 'bg-white/5 group-hover:bg-emerald-500/20'}
              `}
            >
              {uploading ? (
                <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Upload className="w-6 h-6 text-white/40 group-hover:text-emerald-300 transition-colors" />
              )}
            </div>
            <div className="text-center">
              <p className="text-sm text-white/60 group-hover:text-white/80 transition-colors">
                {uploading
                  ? 'Parsing file...'
                  : dragOver
                    ? 'Drop file here'
                    : 'Drag & drop a CSV or Excel file, or click to browse'
                }
              </p>
              <p className="text-xs text-white/30 mt-1">
                Expected columns: Name, Position, Jersey Number, DOB or Age
              </p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={onFileInput}
            className="hidden"
          />

          {uploadError && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {uploadError}
            </div>
          )}

          {preview.length > 0 && (
            <p className="text-sm text-emerald-300">
              {preview.length} player{preview.length !== 1 ? 's' : ''} parsed from file
            </p>
          )}
        </div>
      )}

      {/* Manual Entry Tab */}
      {activeTab === 'manual' && (
        <div className="space-y-4">
          <div className="glass-card p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Player name"
                  className="input-glass text-sm"
                  onKeyDown={(e) => { if (e.key === 'Enter') addManualPlayer(); }}
                />
              </div>

              {/* Position */}
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1">Position</label>
                <select
                  value={form.position}
                  onChange={(e) => setForm({ ...form, position: e.target.value })}
                  className="input-glass text-sm appearance-none cursor-pointer"
                >
                  <option value="" className="bg-[#0a1024] text-white/50">Select...</option>
                  {POSITIONS.map((p) => (
                    <option key={p} value={p.toLowerCase()} className="bg-[#0a1024] text-white">
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              {/* Jersey Number */}
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1">Jersey # <span className="text-white/30">(optional)</span></label>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={form.jersey_number}
                  onChange={(e) => setForm({ ...form, jersey_number: e.target.value })}
                  placeholder="#"
                  className="input-glass text-sm"
                />
              </div>

              {/* DOB */}
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1">Date of Birth</label>
                <input
                  type="date"
                  value={form.date_of_birth}
                  onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
                  className="input-glass text-sm"
                />
              </div>
            </div>

            <button
              onClick={addManualPlayer}
              disabled={!form.name.trim()}
              className="mt-3 btn-primary text-sm py-2 px-4 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              Add Player
            </button>
          </div>

          {/* Manual players list */}
          {manualPlayers.length > 0 && (
            <div className="space-y-2">
              {manualPlayers.map((p, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-white/5 border border-white/10"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-white">{p.name}</span>
                    {p.position && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">
                        {p.position}
                      </span>
                    )}
                    {p.jersey_number && (
                      <span className="text-xs text-white/40">#{p.jersey_number}</span>
                    )}
                  </div>
                  <button
                    onClick={() => removeManualPlayer(idx)}
                    className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-white/40 hover:text-red-300" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Combined Preview Table */}
      {allPlayers.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white/70 mb-3">
            All Players ({allPlayers.length})
          </h3>
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-white/50 uppercase tracking-wider">Name</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-white/50 uppercase tracking-wider">Position</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-white/50 uppercase tracking-wider">Jersey</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-white/50 uppercase tracking-wider">DOB</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-white/50 uppercase tracking-wider">Warnings</th>
                  </tr>
                </thead>
                <tbody>
                  {allPlayers.map((player, idx) => {
                    const hasWarnings = player.warnings && player.warnings.length > 0;
                    return (
                      <tr
                        key={idx}
                        className={`
                          border-b border-white/5 last:border-b-0 transition-colors
                          ${hasWarnings ? 'bg-amber-500/5' : 'hover:bg-white/5'}
                        `}
                      >
                        <td className="py-2.5 px-4 text-white font-medium">{player.name}</td>
                        <td className="py-2.5 px-4 text-white/60 capitalize">{player.position || '-'}</td>
                        <td className="py-2.5 px-4 text-white/60">{player.jersey_number ?? '-'}</td>
                        <td className="py-2.5 px-4 text-white/60">{player.date_of_birth || '-'}</td>
                        <td className="py-2.5 px-4">
                          {hasWarnings ? (
                            <div className="flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                              <span className="text-xs text-amber-300">
                                {player.warnings!.join('; ')}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-white/20">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
