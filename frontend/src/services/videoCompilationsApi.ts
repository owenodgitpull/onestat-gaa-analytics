/**
 * Video Compilations API (Phase 10) — read/download side for AI-built
 * clip compilations. Creation happens via the create_video_compilation
 * agent tool in chat, not through this API.
 */

import { fetchAPI } from './api';

export type VideoCompilationStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface VideoCompilationItem {
  id: string;
  title: string;
  status: VideoCompilationStatus;
  clip_count: number;
  player_id: string | null;
  event_type: string | null;
  error_message: string | null;
  output_duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
}

export const videoCompilationsAPI = {
  list: () => fetchAPI<VideoCompilationItem[]>('/video-compilations'),

  get: (id: string) => fetchAPI<VideoCompilationItem>(`/video-compilations/${id}`),

  getDownloadUrl: (id: string) =>
    fetchAPI<{ download_url: string }>(`/video-compilations/${id}/download-url`),

  remove: (id: string) => fetchAPI<void>(`/video-compilations/${id}`, { method: 'DELETE' }),
};
