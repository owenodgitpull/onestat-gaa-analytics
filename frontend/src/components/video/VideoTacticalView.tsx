import { useState, useEffect, useRef, useCallback } from 'react';
import { useOpenCV } from '../../hooks/useOpenCV';
import CalibrationOverlay from './CalibrationOverlay';
import BirdsEyeCanvas, { transformPoint } from './BirdsEyeCanvas';
import TacticalAnnotationLayer from './TacticalAnnotationLayer';
import { tacticalApi, type DetectedPlayer } from '../../services/tacticalApi';

type ViewState = 'CALIBRATING' | 'DETECTING' | 'ANNOTATING' | 'SAVED';

interface VideoTacticalViewProps {
  videoElement: HTMLVideoElement;
  matchId: string;
  videoSessionId?: string;
  currentTimeMs: number;
  roster?: { jersey_number: number; name: string; position?: string }[];
  teamColors?: { own: string; opponent: string };
  onClose: () => void;
}

export default function VideoTacticalView({
  videoElement,
  matchId,
  videoSessionId,
  currentTimeMs,
  roster = [],
  teamColors,
  onClose,
}: VideoTacticalViewProps) {
  const { cv, loading: cvLoading, error: cvError, ready: cvReady } = useOpenCV();
  const [state, setState] = useState<ViewState>('CALIBRATING');
  const [calibrationPoints, setCalibrationPoints] = useState<{ pixelX: number; pixelY: number }[]>([]);
  const [frameImageData, setFrameImageData] = useState<ImageData | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [frameHeight, setFrameHeight] = useState(0);
  const [detectedPlayers, setDetectedPlayers] = useState<any[]>([]);
  const [annotations, setAnnotations] = useState<{ arrows: any[]; labels: any[] }>({ arrows: [], labels: [] });
  const [annotationMode, setAnnotationMode] = useState<'select' | 'arrow' | 'label'>('select');
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [warpedCanvas, setWarpedCanvas] = useState<HTMLCanvasElement | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement>(null);

  const OUTPUT_W = 580;
  const OUTPUT_H = 360;

  // Capture frame on mount
  useEffect(() => {
    const canvas = frameCanvasRef.current;
    if (!canvas || !videoElement) return;

    const w = videoElement.videoWidth;
    const h = videoElement.videoHeight;
    canvas.width = w;
    canvas.height = h;
    setFrameWidth(w);
    setFrameHeight(h);

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoElement, 0, 0, w, h);
      setFrameImageData(ctx.getImageData(0, 0, w, h));
    }
  }, [videoElement]);

  // Handle calibration complete
  const handleCalibrationComplete = useCallback(
    (points: { pixelX: number; pixelY: number }[]) => {
      setCalibrationPoints(points);
      setState('DETECTING');

      // Auto-detect players
      detectPlayers(points);
    },
    []
  );

  // Detect players via Claude Vision
  const detectPlayers = async (_calibPoints?: any) => {
    setDetecting(true);
    try {
      const canvas = frameCanvasRef.current;
      if (!canvas) return;

      const frameBase64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
      const result = await tacticalApi.detectPlayers(frameBase64, roster, teamColors);

      // Transform detected pixel positions to bird's-eye positions
      const mappedPlayers = result.players.map((p: DetectedPlayer, i: number) => {
        const pixelX = p.pixel_x * frameWidth;
        const pixelY = p.pixel_y * frameHeight;

        const transformed = cvReady
          ? transformPoint(pixelX, pixelY, calibrationPoints, OUTPUT_W, OUTPUT_H, cv)
          : null;

        return {
          id: `player-${i}`,
          x: transformed?.x ?? (OUTPUT_W * p.pixel_x),
          y: transformed?.y ?? (OUTPUT_H * p.pixel_y),
          jerseyNumber: p.jersey_number,
          team: p.team,
          confidence: p.confidence,
        };
      });

      setDetectedPlayers(mappedPlayers);
      setState('ANNOTATING');
    } catch (e) {
      console.error('Player detection failed:', e);
      setState('ANNOTATING'); // Still allow manual annotation
    } finally {
      setDetecting(false);
    }
  };

  // Save snapshot
  const handleSave = async () => {
    setSaving(true);
    try {
      let warpedKey: string | undefined;

      // Upload warped image if available
      if (warpedCanvas) {
        try {
          const { upload_url, key } = await tacticalApi.getWarpedUploadUrl();
          const blob = await new Promise<Blob>((resolve) =>
            warpedCanvas.toBlob((b) => resolve(b!), 'image/png')
          );
          await fetch(upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/png' } });
          warpedKey = key;
        } catch (e) {
          console.warn('Warped image upload failed:', e);
        }
      }

      await tacticalApi.saveSnapshot({
        match_id: matchId,
        video_session_id: videoSessionId,
        video_timestamp_ms: currentTimeMs,
        calibration_points: calibrationPoints.map((p, i) => ({
          pixel_x: p.pixelX,
          pixel_y: p.pixelY,
          pitch_x: [0, 1, 1, 0][i], // normalized pitch corners
          pitch_y: [0, 0, 1, 1][i],
        })),
        detected_players: detectedPlayers,
        annotations: [...annotations.arrows, ...annotations.labels],
        warped_image_key: warpedKey,
      });

      setState('SAVED');
    } catch (e) {
      console.error('Save failed:', e);
    } finally {
      setSaving(false);
    }
  };

  // Export as PNG
  const handleExport = () => {
    if (!warpedCanvas) return;

    // Draw annotations onto canvas copy
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = OUTPUT_W;
    exportCanvas.height = OUTPUT_H;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(warpedCanvas, 0, 0);

    // Draw player dots
    detectedPlayers.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
      ctx.fillStyle = p.team === 'own' ? '#22c55e' : '#ef4444';
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (p.jerseyNumber !== null) {
        ctx.fillStyle = 'white';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(p.jerseyNumber), p.x, p.y + 4);
      }
    });

    const link = document.createElement('a');
    link.download = `tactical-analysis-${Date.now()}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-700">
        <h2 className="text-white font-semibold">Tactical View</h2>
        <div className="flex items-center gap-2">
          {state === 'ANNOTATING' && (
            <>
              <div className="flex bg-gray-800 rounded-lg overflow-hidden mr-2">
                {(['select', 'arrow', 'label'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setAnnotationMode(m)}
                    className={`px-3 py-1.5 text-xs capitalize ${
                      annotationMode === m ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <button
                onClick={handleExport}
                className="px-3 py-1.5 bg-gray-700 text-white text-xs rounded-lg hover:bg-gray-600"
              >
                Export PNG
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-500 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          )}
          {state === 'SAVED' && (
            <span className="text-green-400 text-sm">Saved!</span>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-gray-700 text-white text-xs rounded-lg hover:bg-gray-600"
          >
            Close
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center p-4">
        {/* Loading OpenCV indicator (non-blocking) */}
        {cvLoading && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-white/10 text-white/60 text-xs px-3 py-1.5 rounded-lg z-10 flex items-center gap-2">
            <div className="animate-spin w-3 h-3 border-2 border-white/40 border-t-white rounded-full" />
            Loading OpenCV.js for bird's-eye view...
          </div>
        )}

        {cvError && state === 'CALIBRATING' && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs px-3 py-1.5 rounded-lg z-10">
            Bird's-eye warp unavailable — calibration + player detection still work
          </div>
        )}

        {/* Calibration state */}
        {state === 'CALIBRATING' && (
          <div className="relative" style={{ width: '80vw', maxWidth: 960 }}>
            <canvas
              ref={frameCanvasRef}
              className="w-full rounded-lg"
              style={{ aspectRatio: `${frameWidth}/${frameHeight}` }}
            />
            {frameWidth > 0 && (
              <CalibrationOverlay
                imageWidth={frameWidth}
                imageHeight={frameHeight}
                onComplete={handleCalibrationComplete}
                onCancel={onClose}
              />
            )}
          </div>
        )}

        {/* Detecting state */}
        {(state === 'DETECTING' || detecting) && (
          <div className="text-white text-center">
            <div className="animate-spin w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full mx-auto mb-3" />
            <p>Detecting players with Claude Vision...</p>
          </div>
        )}

        {/* Annotating / Saved state */}
        {(state === 'ANNOTATING' || state === 'SAVED') && !detecting && (
          <div className="relative" style={{ width: OUTPUT_W, height: OUTPUT_H }}>
            <BirdsEyeCanvas
              frameImageData={frameImageData}
              calibrationPoints={calibrationPoints}
              outputWidth={OUTPUT_W}
              outputHeight={OUTPUT_H}
              cv={cv}
              onWarpComplete={setWarpedCanvas}
            />
            <TacticalAnnotationLayer
              width={OUTPUT_W}
              height={OUTPUT_H}
              players={detectedPlayers}
              onPlayersChange={setDetectedPlayers}
              annotations={annotations}
              onAnnotationsChange={setAnnotations}
              mode={annotationMode}
            />
          </div>
        )}
      </div>

      {/* Hidden canvas for frame capture (needed during calibration) */}
      {state !== 'CALIBRATING' && (
        <canvas ref={frameCanvasRef} className="hidden" />
      )}
    </div>
  );
}
