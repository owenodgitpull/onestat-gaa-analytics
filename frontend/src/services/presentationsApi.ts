/**
 * Presentations API Service Layer (Phase 11)
 *
 * Coach-built video/tactical decks — club-wide, not scoped to one match.
 * Each slide is a clip (tagged VideoEvent, trimmed), a tactical animation
 * (existing SetPieceRoutine), or a text card.
 */

import { fetchAPI } from './api';

export type SlideType = 'clip' | 'animation' | 'text';

export interface PresentationSlide {
  id: string;
  slide_order: number;
  slide_type: SlideType;
  video_session_id: string | null;
  clip_start_ms: number | null;
  clip_end_ms: number | null;
  clip_label: string | null;
  set_piece_routine_id: string | null;
  text_title: string | null;
  text_body: string | null;
  created_at: string;
}

export interface Presentation {
  id: string;
  title: string;
  slides: PresentationSlide[];
  created_at: string;
  updated_at: string;
}

export interface PresentationListItem {
  id: string;
  title: string;
  slide_count: number;
  updated_at: string;
}

export interface ClipLibraryEntry {
  video_event_id: string;
  video_session_id: string;
  video_timestamp_ms: number;
  event_type: string;
  player_id: string | null;
  player_name: string | null;
  opponent_player_name: string | null;
  match_id: string;
  opponent: string;
  match_date: string | null;
  suggested_label: string;
}

export interface ClipLibraryFilter {
  playerId?: string;
  eventType?: string;
  matchId?: string;
  search?: string;
}

// Default clip window around a tagged event's video timestamp — a wide
// needs the buildup, not just the miss. Editable afterward via clip_start_ms/
// clip_end_ms on the slide (mirrors Framesports' "Edit duration" control).
export const DEFAULT_CLIP_LEAD_MS = 6000;
export const DEFAULT_CLIP_TAIL_MS = 4000;

function clipLibraryQS(filter?: ClipLibraryFilter): string {
  if (!filter) return '';
  const params = new URLSearchParams();
  if (filter.playerId) params.set('player_id', filter.playerId);
  if (filter.eventType) params.set('event_type', filter.eventType);
  if (filter.matchId) params.set('match_id', filter.matchId);
  if (filter.search) params.set('search', filter.search);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const presentationsAPI = {
  list: () => fetchAPI<PresentationListItem[]>('/presentations'),

  create: (title: string) =>
    fetchAPI<Presentation>('/presentations', { method: 'POST', body: JSON.stringify({ title }) }),

  get: (id: string) => fetchAPI<Presentation>(`/presentations/${id}`),

  rename: (id: string, title: string) =>
    fetchAPI<Presentation>(`/presentations/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),

  remove: (id: string) => fetchAPI<void>(`/presentations/${id}`, { method: 'DELETE' }),

  addClipSlide: (presentationId: string, data: {
    video_session_id: string; clip_start_ms: number; clip_end_ms: number; clip_label?: string;
  }) =>
    fetchAPI<PresentationSlide>(`/presentations/${presentationId}/slides`, {
      method: 'POST',
      body: JSON.stringify({ slide_type: 'clip', ...data }),
    }),

  addAnimationSlide: (presentationId: string, setPieceRoutineId: string) =>
    fetchAPI<PresentationSlide>(`/presentations/${presentationId}/slides`, {
      method: 'POST',
      body: JSON.stringify({ slide_type: 'animation', set_piece_routine_id: setPieceRoutineId }),
    }),

  addTextSlide: (presentationId: string, textTitle: string, textBody?: string) =>
    fetchAPI<PresentationSlide>(`/presentations/${presentationId}/slides`, {
      method: 'POST',
      body: JSON.stringify({ slide_type: 'text', text_title: textTitle, text_body: textBody }),
    }),

  updateSlide: (presentationId: string, slideId: string, data: Partial<{
    clip_start_ms: number; clip_end_ms: number; clip_label: string;
    set_piece_routine_id: string; text_title: string; text_body: string;
  }>) =>
    fetchAPI<PresentationSlide>(`/presentations/${presentationId}/slides/${slideId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteSlide: (presentationId: string, slideId: string) =>
    fetchAPI<void>(`/presentations/${presentationId}/slides/${slideId}`, { method: 'DELETE' }),

  reorderSlides: (presentationId: string, slideIds: string[]) =>
    fetchAPI<PresentationSlide[]>(`/presentations/${presentationId}/slides/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ slide_ids: slideIds }),
    }),

  searchClipLibrary: (filter?: ClipLibraryFilter) =>
    fetchAPI<ClipLibraryEntry[]>(`/presentations/clip-library/search${clipLibraryQS(filter)}`),
};
