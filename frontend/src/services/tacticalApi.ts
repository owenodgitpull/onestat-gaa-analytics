import { fetchAPI } from './api';

export interface DetectedPlayer {
  jersey_number: number | null;
  team: 'own' | 'opponent';
  pixel_x: number;
  pixel_y: number;
  confidence: number;
}

export interface TacticalSnapshot {
  id: string;
  match_id: string;
  video_session_id?: string | null;
  video_timestamp_ms?: number | null;
  calibration_points?: { pixel_x: number; pixel_y: number; pitch_x: number; pitch_y: number }[] | null;
  homography_matrix?: number[] | null;
  detected_players?: DetectedPlayer[] | null;
  annotations?: any[] | null;
  warped_image_key?: string | null;
  original_frame_key?: string | null;
  notes?: string | null;
  created_at?: string | null;
}

export const tacticalApi = {
  detectPlayers: (frameBase64: string, roster: any[] = [], teamColors?: { own: string; opponent: string }) =>
    fetchAPI<{ players: DetectedPlayer[]; raw_analysis?: string }>('/tactical/detect-players', {
      method: 'POST',
      body: JSON.stringify({ frame_base64: frameBase64, roster, team_colors: teamColors }),
    }),

  saveSnapshot: (data: Omit<TacticalSnapshot, 'id' | 'created_at'>) =>
    fetchAPI<TacticalSnapshot>('/tactical/snapshots', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getSnapshots: (matchId: string) =>
    fetchAPI<TacticalSnapshot[]>(`/tactical/snapshots?match_id=${matchId}`),

  getSnapshot: (id: string) =>
    fetchAPI<TacticalSnapshot>(`/tactical/snapshots/${id}`),

  deleteSnapshot: (id: string) =>
    fetchAPI<{ success: boolean }>(`/tactical/snapshots/${id}`, { method: 'DELETE' }),

  getWarpedUploadUrl: () =>
    fetchAPI<{ upload_url: string; key: string }>('/tactical/upload-warped', { method: 'POST' }),
};
