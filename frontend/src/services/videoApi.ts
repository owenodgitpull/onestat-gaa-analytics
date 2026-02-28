/**
 * Video Analysis API Service Layer
 *
 * Handles video upload (presigned URL flow), session management,
 * event CRUD, and LLM enrichment.
 */

import { fetchAPI, API_BASE } from './api';

// ============================================================================
// Types
// ============================================================================

export interface VideoSession {
  id: string;
  match_id: string;
  club_id: string;
  title: string;
  half: number | null;
  video_r2_key: string | null;
  video_duration_ms: number | null;
  video_size_bytes: number | null;
  halftime_timestamp_ms: number | null;
  status: string;
  ai_model_used: string | null;
  ai_events_generated: number | null;
  ai_events_accepted: number | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  event_count: number;
  download_url: string | null;
}

export interface ScoringContext {
  source?: string;
  foot?: string;
  under_pressure?: boolean;
  distance_estimate?: string;
  is_two_pointer?: boolean;
  scored?: boolean;
  wide?: boolean;
}

export interface KickoutContext {
  direction?: string;
  won_by?: string;
  clean_catch?: boolean;
}

export interface VideoEvent {
  id: string;
  video_session_id: string;
  match_id: string;
  event_type: string;
  team: string;
  half: number;
  match_minute: number;
  match_second: number;
  video_timestamp_ms: number | null;
  pitch_zone: string | null;
  pitch_x: number | null;
  pitch_y: number | null;
  player_id: string | null;
  player_name: string | null;
  jersey_number: number | null;
  player_confidence: string | null;
  event_confidence: string | null;
  scoring_context: ScoringContext | null;
  kickout_context: KickoutContext | null;
  possession_chain_id: string | null;
  possession_team: string | null;
  description: string | null;
  source: string;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface VideoEventCreateData {
  event_type: string;
  team: string;
  half: number;
  match_minute: number;
  match_second?: number;
  video_timestamp_ms?: number;
  pitch_zone?: string;
  pitch_x?: number;
  pitch_y?: number;
  player_id?: string;
  jersey_number?: number;
  player_confidence?: string;
  event_confidence?: string;
  scoring_context?: ScoringContext;
  kickout_context?: KickoutContext;
  possession_team?: string;
  description?: string;
  source?: string;
}

export interface VideoEventUpdateData {
  event_type?: string;
  team?: string;
  half?: number;
  match_minute?: number;
  match_second?: number;
  video_timestamp_ms?: number;
  pitch_zone?: string;
  pitch_x?: number;
  pitch_y?: number;
  player_id?: string;
  jersey_number?: number;
  scoring_context?: ScoringContext;
  kickout_context?: KickoutContext;
  possession_team?: string;
  description?: string;
}

export interface VideoSyncResult {
  synced_count: number;
  skipped_count: number;
  errors: string[];
}

export interface SyncPreviewEvent {
  video_event_id: string;
  event_type: string;
  team: string;
  minute: number;
  pitch_zone: string | null;
  description: string | null;
  matched_event_id: string | null;
}

export interface VideoSyncPreview {
  new_events: SyncPreviewEvent[];
  replaced_events: SyncPreviewEvent[];
  skipped_events: SyncPreviewEvent[];
  manual_only_count: number;
}

export interface VideoSyncConfirmResult {
  status: string;
  synced_count: number;
  replaced_count: number;
  message: string;
}

export interface VideoSyncStatus {
  status: string;
  synced_count: number | null;
  ai_report_ready: boolean;
  error_message: string | null;
}

export interface EnrichmentResult {
  report: string | null;
  suggestions: Array<{ type: string; description: string; [key: string]: any }> | null;
  possession_chains_created: number;
}

// ============================================================================
// Video Session API
// ============================================================================

export const videoSessionsAPI = {
  /** Initiate video upload — returns presigned PUT URL for direct R2 upload. */
  initiateUpload: (
    matchId: string,
    data: { title: string; half?: number; content_type?: string; file_size_bytes?: number }
  ) =>
    fetchAPI<{ session_id: string; upload_url: string; r2_key: string }>(
      `/video/upload/initiate?match_id=${matchId}`,
      { method: 'POST', body: JSON.stringify(data) }
    ),

  /** Confirm upload is complete. */
  completeUpload: (
    sessionId: string,
    data?: { video_duration_ms?: number; video_size_bytes?: number }
  ) =>
    fetchAPI<VideoSession>(
      `/video/session/${sessionId}/upload-complete`,
      { method: 'POST', body: JSON.stringify(data || {}) }
    ),

  /** List video sessions for a match. */
  listByMatch: (matchId: string) =>
    fetchAPI<{ sessions: VideoSession[] }>(`/video/sessions/${matchId}`),

  /** Get a single video session with download URL. */
  get: (sessionId: string) =>
    fetchAPI<VideoSession>(`/video/session/${sessionId}`),

  /** Delete a video session. */
  delete: (sessionId: string) =>
    fetchAPI<{ detail: string }>(`/video/session/${sessionId}`, { method: 'DELETE' }),

  /** Run LLM enrichment on tagged events. */
  enrich: (sessionId: string) =>
    fetchAPI<EnrichmentResult>(`/video/session/${sessionId}/enrich`, { method: 'POST' }),

  /** Set the half-time timestamp for a full-match video. */
  setHalftime: (sessionId: string, halftimeMs: number) =>
    fetchAPI<VideoSession>(
      `/video/session/${sessionId}/set-halftime`,
      { method: 'POST', body: JSON.stringify({ halftime_timestamp_ms: halftimeMs }) }
    ),

  /** Trigger keyframe + Claude Vision auto-analysis. */
  autoAnalyze: (sessionId: string) =>
    fetchAPI<{ status: string }>(`/video/session/${sessionId}/keyframe-analyze`, { method: 'POST' }),

  /** Re-run low-confidence batches through Sonnet for better accuracy. */
  improveAnalysis: (sessionId: string) =>
    fetchAPI<{ status: string }>(`/video/session/${sessionId}/improve-analysis`, { method: 'POST' }),

  /**
   * SSE streaming analysis — starts background task then connects to progress stream.
   *
   * Two-step approach:
   * 1. POST /keyframe-analyze — starts background task (returns immediately)
   * 2. GET /analysis-progress — SSE stream reads from in-memory queue
   *
   * This is reliable because the heavy work runs in a proven background task,
   * and the SSE endpoint is a lightweight reader with no imports or DB work.
   */
  streamAnalysis: (
    sessionId: string,
    callbacks: {
      onProgress: (stage: string, detail?: Record<string, unknown>) => void
      onBatchComplete?: () => void
      onDone: (totalEvents: number) => void
      onError: (message: string) => void
    }
  ): { promise: Promise<void>; abort: () => void } => {
    const controller = new AbortController();

    const promise = (async () => {
      // 1. Start the background analysis task
      await fetchAPI(`/video/session/${sessionId}/keyframe-analyze`, { method: 'POST' });

      // 2. Connect to SSE progress stream
      const url = `${API_BASE}/video/session/${sessionId}/analysis-progress`;
      const response = await fetch(url, {
        credentials: 'include',
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        callbacks.onError(errorData.detail || `API Error: ${response.status}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        callbacks.onError('No response stream available');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const payload = JSON.parse(trimmed.slice(6));
            switch (payload.type) {
              case 'progress':
                callbacks.onProgress(payload.stage, payload);
                if (payload.batch_complete && callbacks.onBatchComplete) {
                  callbacks.onBatchComplete();
                }
                break;
              case 'done':
                callbacks.onDone(payload.total_events);
                return;
              case 'error':
                callbacks.onError(payload.message);
                return;
              case 'heartbeat':
                break;
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    })();

    return { promise, abort: () => controller.abort() };
  },

  /**
   * Upload file directly to R2 via presigned URL.
   * Returns upload progress via onProgress callback.
   */
  uploadToR2: (
    uploadUrl: string,
    file: File,
    contentType: string,
    onProgress?: (percent: number) => void
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Content-Type', contentType);

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Upload network error')));
      xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

      xhr.send(file);
    });
  },
};

// ============================================================================
// Video Events API
// ============================================================================

export const videoEventsAPI = {
  /** Create a single video event. */
  create: (sessionId: string, data: VideoEventCreateData) =>
    fetchAPI<VideoEvent>(`/video/events/${sessionId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** List events for a session. */
  list: (sessionId: string) =>
    fetchAPI<{ events: VideoEvent[]; total: number }>(`/video/events/${sessionId}`),

  /** Update an event. */
  update: (eventId: string, data: VideoEventUpdateData) =>
    fetchAPI<VideoEvent>(`/video/events/event/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  /** Delete an event. */
  delete: (eventId: string) =>
    fetchAPI<{ detail: string }>(`/video/events/event/${eventId}`, { method: 'DELETE' }),

  /** Bulk create events. */
  bulkCreate: (sessionId: string, events: VideoEventCreateData[]) =>
    fetchAPI<{ events: VideoEvent[]; total: number }>(`/video/events/${sessionId}/bulk`, {
      method: 'POST',
      body: JSON.stringify({ events }),
    }),

  /** Mark event as verified. */
  verify: (eventId: string) =>
    fetchAPI<VideoEvent>(`/video/events/event/${eventId}/verify`, { method: 'PUT' }),

  /** Sync verified events to MatchEvent table (legacy). */
  syncToMatch: (sessionId: string) =>
    fetchAPI<VideoSyncResult>(`/video/events/${sessionId}/sync-to-match`, { method: 'POST' }),

  /** Preview what sync will do — deduplication analysis. */
  syncPreview: (sessionId: string) =>
    fetchAPI<VideoSyncPreview>(`/video/events/${sessionId}/sync-preview`, { method: 'POST' }),

  /** Confirm sync — performs merge + triggers AI re-analysis in background. */
  syncConfirm: (sessionId: string) =>
    fetchAPI<VideoSyncConfirmResult>(`/video/events/${sessionId}/sync-confirm`, { method: 'POST' }),

  /** Poll sync + AI re-analysis progress. */
  syncStatus: (sessionId: string) =>
    fetchAPI<VideoSyncStatus>(`/video/events/${sessionId}/sync-status`),
};
