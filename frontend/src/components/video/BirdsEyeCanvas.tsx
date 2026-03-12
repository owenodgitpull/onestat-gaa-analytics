import { useEffect, useRef, useCallback } from 'react';

interface BirdsEyeCanvasProps {
  frameImageData: ImageData | null;
  calibrationPoints: { pixelX: number; pixelY: number }[];
  outputWidth?: number;
  outputHeight?: number;
  cv: any; // OpenCV.js instance
  onWarpComplete?: (canvas: HTMLCanvasElement) => void;
}

export default function BirdsEyeCanvas({
  frameImageData,
  calibrationPoints,
  outputWidth = 580,
  outputHeight = 360,
  cv,
  onWarpComplete,
}: BirdsEyeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const warp = useCallback(() => {
    if (!cv || !frameImageData || calibrationPoints.length !== 4 || !canvasRef.current) return;

    try {
      const canvas = canvasRef.current;
      canvas.width = outputWidth;
      canvas.height = outputHeight;

      // Create source Mat from ImageData
      const src = cv.matFromImageData(frameImageData);

      // Source points (user-tapped corners)
      const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        calibrationPoints[0].pixelX, calibrationPoints[0].pixelY,
        calibrationPoints[1].pixelX, calibrationPoints[1].pixelY,
        calibrationPoints[2].pixelX, calibrationPoints[2].pixelY,
        calibrationPoints[3].pixelX, calibrationPoints[3].pixelY,
      ]);

      // Destination points (bird's eye rectangle)
      const margin = 20;
      const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        margin, outputHeight - margin,              // bottom-left
        outputWidth - margin, outputHeight - margin, // bottom-right
        outputWidth - margin, margin,                // top-right
        margin, margin,                              // top-left
      ]);

      // Compute homography
      const M = cv.getPerspectiveTransform(srcPts, dstPts);

      // Warp perspective
      const dst = new cv.Mat();
      const dsize = new cv.Size(outputWidth, outputHeight);
      cv.warpPerspective(src, dst, M, dsize);

      // Draw to canvas
      cv.imshow(canvas, dst);

      // Cleanup
      src.delete();
      srcPts.delete();
      dstPts.delete();
      M.delete();
      dst.delete();

      onWarpComplete?.(canvas);
    } catch (e) {
      console.error('Warp perspective failed:', e);
    }
  }, [cv, frameImageData, calibrationPoints, outputWidth, outputHeight, onWarpComplete]);

  useEffect(() => {
    warp();
  }, [warp]);

  return (
    <canvas
      ref={canvasRef}
      className="rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-900"
      style={{ width: outputWidth, height: outputHeight }}
    />
  );
}

/**
 * Transform pixel coordinates through a homography matrix.
 * Used to map detected player positions to bird's-eye view.
 */
export function transformPoint(
  px: number,
  py: number,
  calibrationPoints: { pixelX: number; pixelY: number }[],
  outputWidth: number,
  outputHeight: number,
  cv: any,
): { x: number; y: number } | null {
  if (!cv || calibrationPoints.length !== 4) return null;

  try {
    const margin = 20;
    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      calibrationPoints[0].pixelX, calibrationPoints[0].pixelY,
      calibrationPoints[1].pixelX, calibrationPoints[1].pixelY,
      calibrationPoints[2].pixelX, calibrationPoints[2].pixelY,
      calibrationPoints[3].pixelX, calibrationPoints[3].pixelY,
    ]);
    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      margin, outputHeight - margin,
      outputWidth - margin, outputHeight - margin,
      outputWidth - margin, margin,
      margin, margin,
    ]);

    const M = cv.getPerspectiveTransform(srcPts, dstPts);
    const data = M.data64F;

    // Apply homography: [x', y', w'] = M * [px, py, 1]
    const xp = data[0] * px + data[1] * py + data[2];
    const yp = data[3] * px + data[4] * py + data[5];
    const wp = data[6] * px + data[7] * py + data[8];

    srcPts.delete();
    dstPts.delete();
    M.delete();

    return { x: xp / wp, y: yp / wp };
  } catch {
    return null;
  }
}
