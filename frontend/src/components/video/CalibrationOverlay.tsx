import { useState, useCallback } from 'react';

interface CalibrationPoint {
  pixelX: number;
  pixelY: number;
}

interface CalibrationOverlayProps {
  imageWidth: number;
  imageHeight: number;
  onComplete: (points: CalibrationPoint[]) => void;
  onCancel: () => void;
}

const CORNER_LABELS = [
  'Bottom-left corner of pitch',
  'Bottom-right corner of pitch',
  'Top-right corner of pitch',
  'Top-left corner of pitch',
];

export default function CalibrationOverlay({
  imageWidth,
  imageHeight,
  onComplete,
  onCancel,
}: CalibrationOverlayProps) {
  const [points, setPoints] = useState<CalibrationPoint[]>([]);

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (points.length >= 4) return;

      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * imageWidth;
      const y = ((e.clientY - rect.top) / rect.height) * imageHeight;

      const newPoints = [...points, { pixelX: x, pixelY: y }];
      setPoints(newPoints);

      if (newPoints.length === 4) {
        onComplete(newPoints);
      }
    },
    [points, imageWidth, imageHeight, onComplete]
  );

  const handleUndo = () => {
    setPoints((prev) => prev.slice(0, -1));
  };

  return (
    <div className="absolute inset-0">
      {/* Instruction banner */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-black/80 text-white px-4 py-2 rounded-lg text-sm">
        {points.length < 4 ? (
          <>
            Tap {CORNER_LABELS[points.length]}{' '}
            <span className="text-gray-400">({points.length + 1}/4)</span>
          </>
        ) : (
          'Calibration complete!'
        )}
      </div>

      {/* SVG overlay */}
      <svg
        className="absolute inset-0 w-full h-full cursor-crosshair"
        viewBox={`0 0 ${imageWidth} ${imageHeight}`}
        preserveAspectRatio="none"
        onClick={handleClick}
      >
        {/* Draw lines between points */}
        {points.length >= 2 &&
          points.map((p, i) => {
            const next = points[(i + 1) % points.length];
            if (i >= points.length - 1 && points.length < 4) return null;
            return (
              <line
                key={`line-${i}`}
                x1={p.pixelX}
                y1={p.pixelY}
                x2={next.pixelX}
                y2={next.pixelY}
                stroke="#00ff88"
                strokeWidth={2}
                strokeDasharray="8,4"
              />
            );
          })}

        {/* Draw points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.pixelX} cy={p.pixelY} r={12} fill="#00ff88" fillOpacity={0.3} stroke="#00ff88" strokeWidth={2} />
            <text x={p.pixelX} y={p.pixelY + 5} textAnchor="middle" fill="white" fontSize={14} fontWeight="bold">
              {i + 1}
            </text>
          </g>
        ))}
      </svg>

      {/* Controls */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex gap-2">
        {points.length > 0 && (
          <button
            onClick={handleUndo}
            className="px-3 py-1.5 bg-yellow-600 text-white rounded-lg text-sm hover:bg-yellow-500"
          >
            Undo
          </button>
        )}
        <button
          onClick={onCancel}
          className="px-3 py-1.5 bg-gray-600 text-white rounded-lg text-sm hover:bg-gray-500"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
