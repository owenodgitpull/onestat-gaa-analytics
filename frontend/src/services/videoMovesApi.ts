/**
 * Fixing a tagged move (carries and passes) and the data-health check for a video session.
 * Backend: backend/app/routes/video_moves.py
 */
import { fetchAPI } from './api'

export interface MoveStep {
  segment_id: string
  sequence_number: number
  team: 'team_a' | 'team_b'
  player_id: string | null
  opposition_player_id: string | null
  name: string | null
  jersey_number: number | null
  ended_by: string | null
  video_timestamp_ms: number | null
  match_clock_s: number | null
  start: { x: number | null; y: number | null }
  end: { x: number | null; y: number | null }
  pass_event_id: string | null
}

export interface MoveResponse {
  event_id: string
  event_type: string
  team: 'team_a' | 'team_b'
  match_minute: number | null
  match_second: number | null
  steps: MoveStep[]
}

export interface HealthIssue {
  kind: string
  message: string
  event_id: string | null
  segment_id?: string | null
  video_timestamp_ms: number | null
  match_minute: number | null
  match_second: number | null
  team: 'team_a' | 'team_b' | null
}

export interface StepPlayerInput {
  player_id?: string | null
  opposition_player_id?: string | null
  jersey_number?: number | null
}

export const videoMovesAPI = {
  /** The chain of carries behind an event (a score, a kickout won, a turnover). */
  getMove: (sessionId: string, eventId: string) =>
    fetchAPI<MoveResponse>(`/video/moves/${sessionId}/move?event_id=${eventId}`),

  /** Change who carried at a step (and who made the pass that came out of it). */
  setStepPlayer: (sessionId: string, segmentId: string, body: StepPlayerInput) =>
    fetchAPI<{ ok: boolean }>(`/video/moves/${sessionId}/move/step/${segmentId}/player`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  /** Remove a step that should not be there. */
  deleteStep: (sessionId: string, segmentId: string) =>
    fetchAPI<{ ok: boolean }>(`/video/moves/${sessionId}/move/step/${segmentId}`, { method: 'DELETE' }),

  /** Add a missing carry after a step. */
  insertStep: (sessionId: string, body: StepPlayerInput & { after_segment_id: string }) =>
    fetchAPI<{ ok: boolean }>(`/video/moves/${sessionId}/move/step`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  /** Blanks and oddities in this session's tagging, each with where to fix it. */
  health: (sessionId: string) =>
    fetchAPI<{ count: number; issues: HealthIssue[] }>(`/video/moves/${sessionId}/health`),
}
