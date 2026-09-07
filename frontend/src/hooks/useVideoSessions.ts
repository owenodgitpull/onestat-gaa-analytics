/**
 * React Query hooks for Video Session management
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { videoSessionsAPI, type VideoSession, type MultipartPartInfo } from '../services/videoApi';

export const videoSessionKeys = {
  all: ['videoSessions'] as const,
  byMatch: (matchId: string) => ['videoSessions', matchId] as const,
  detail: (sessionId: string) => ['videoSessions', 'detail', sessionId] as const,
};

/** List video sessions for a match. */
export function useVideoSessions(matchId: string | null) {
  return useQuery({
    queryKey: videoSessionKeys.byMatch(matchId!),
    queryFn: () => videoSessionsAPI.listByMatch(matchId!),
    enabled: !!matchId,
  });
}

/** Get a single video session with download URL. */
export function useVideoSession(sessionId: string | null) {
  return useQuery({
    queryKey: videoSessionKeys.detail(sessionId!),
    queryFn: () => videoSessionsAPI.get(sessionId!),
    enabled: !!sessionId,
  });
}

/** Initiate a video upload (get presigned URL). */
export function useInitiateVideoUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      matchId,
      title,
      half,
      contentType,
      fileSizeBytes,
    }: {
      matchId: string;
      title: string;
      half?: number;
      contentType?: string;
      fileSizeBytes?: number;
    }) =>
      videoSessionsAPI.initiateUpload(matchId, {
        title,
        half,
        content_type: contentType,
        file_size_bytes: fileSizeBytes,
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: videoSessionKeys.byMatch(variables.matchId),
      });
    },
  });
}

/** Confirm upload complete. Pass uploadId + parts to finalize a multipart upload. */
export function useCompleteVideoUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sessionId,
      durationMs,
      sizeBytes,
      uploadId,
      parts,
    }: {
      sessionId: string;
      matchId: string;
      durationMs?: number;
      sizeBytes?: number;
      uploadId?: string;
      parts?: MultipartPartInfo[];
    }) =>
      videoSessionsAPI.completeUpload(sessionId, {
        video_duration_ms: durationMs,
        video_size_bytes: sizeBytes,
        upload_id: uploadId,
        parts,
      }),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: videoSessionKeys.byMatch(variables.matchId),
      });
      queryClient.setQueryData<VideoSession>(
        videoSessionKeys.detail(variables.sessionId),
        data
      );
    },
  });
}

/** Best-effort cancel of an in-progress multipart upload. */
export function useAbortMultipartUpload() {
  return useMutation({
    mutationFn: ({ sessionId, uploadId }: { sessionId: string; uploadId: string }) =>
      videoSessionsAPI.abortMultipartUpload(sessionId, uploadId),
  });
}

/** Delete a video session. */
export function useDeleteVideoSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId }: { sessionId: string; matchId: string }) =>
      videoSessionsAPI.delete(sessionId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: videoSessionKeys.byMatch(variables.matchId),
      });
    },
  });
}

/** Set the half-time timestamp for a full-match video. */
export function useSetHalftime() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, halftimeMs }: { sessionId: string; halftimeMs: number }) =>
      videoSessionsAPI.setHalftime(sessionId, halftimeMs),
    onSuccess: (data, variables) => {
      queryClient.setQueryData<VideoSession>(
        videoSessionKeys.detail(variables.sessionId),
        data
      );
    },
  });
}

/** Run LLM enrichment. */
export function useEnrichVideoSession() {
  return useMutation({
    mutationFn: (sessionId: string) => videoSessionsAPI.enrich(sessionId),
  });
}
