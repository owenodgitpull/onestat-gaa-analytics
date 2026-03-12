import { useState, useRef, useCallback } from 'react';

interface PlayerDot {
  id: string;
  x: number;
  y: number;
  jerseyNumber: number | null;
  team: 'own' | 'opponent';
  confidence: number;
}

interface Arrow {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

interface TextLabel {
  id: string;
  x: number;
  y: number;
  text: string;
}

interface TacticalAnnotationLayerProps {
  width: number;
  height: number;
  players: PlayerDot[];
  onPlayersChange: (players: PlayerDot[]) => void;
  annotations: { arrows: Arrow[]; labels: TextLabel[] };
  onAnnotationsChange: (annotations: { arrows: Arrow[]; labels: TextLabel[] }) => void;
  mode: 'select' | 'arrow' | 'label';
}

export default function TacticalAnnotationLayer({
  width,
  height,
  players,
  onPlayersChange,
  annotations,
  onAnnotationsChange,
  mode,
}: TacticalAnnotationLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [arrowStart, setArrowStart] = useState<{ x: number; y: number } | null>(null);
  const [arrowPreview, setArrowPreview] = useState<{ x: number; y: number } | null>(null);

  const getSVGCoords = useCallback(
    (e: React.MouseEvent) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * width,
        y: ((e.clientY - rect.top) / rect.height) * height,
      };
    },
    [width, height]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    if (mode === 'arrow') {
      setArrowStart(getSVGCoords(e));
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (mode === 'arrow' && arrowStart) {
      setArrowPreview(getSVGCoords(e));
    }

    if (dragging) {
      const coords = getSVGCoords(e);
      onPlayersChange(
        players.map((p) => (p.id === dragging ? { ...p, x: coords.x, y: coords.y } : p))
      );
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (mode === 'arrow' && arrowStart) {
      const end = getSVGCoords(e);
      const dist = Math.hypot(end.x - arrowStart.x, end.y - arrowStart.y);
      if (dist > 10) {
        const newArrow: Arrow = {
          id: `arrow-${Date.now()}`,
          x1: arrowStart.x,
          y1: arrowStart.y,
          x2: end.x,
          y2: end.y,
          color: '#ffffff',
        };
        onAnnotationsChange({
          ...annotations,
          arrows: [...annotations.arrows, newArrow],
        });
      }
      setArrowStart(null);
      setArrowPreview(null);
    }

    if (mode === 'label' && !dragging) {
      const coords = getSVGCoords(e);
      const text = prompt('Enter label text:');
      if (text) {
        onAnnotationsChange({
          ...annotations,
          labels: [
            ...annotations.labels,
            { id: `label-${Date.now()}`, x: coords.x, y: coords.y, text },
          ],
        });
      }
    }

    setDragging(null);
  };

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="white" />
        </marker>
      </defs>

      {/* Arrows */}
      {annotations.arrows.map((a) => (
        <line
          key={a.id}
          x1={a.x1}
          y1={a.y1}
          x2={a.x2}
          y2={a.y2}
          stroke={a.color}
          strokeWidth={2.5}
          markerEnd="url(#arrowhead)"
        />
      ))}

      {/* Arrow preview */}
      {arrowStart && arrowPreview && (
        <line
          x1={arrowStart.x}
          y1={arrowStart.y}
          x2={arrowPreview.x}
          y2={arrowPreview.y}
          stroke="white"
          strokeWidth={2}
          strokeDasharray="6,3"
          markerEnd="url(#arrowhead)"
          opacity={0.6}
        />
      )}

      {/* Player dots */}
      {players.map((p) => (
        <g
          key={p.id}
          style={{ cursor: mode === 'select' ? 'grab' : 'default' }}
          onMouseDown={(e) => {
            if (mode === 'select') {
              e.stopPropagation();
              setDragging(p.id);
            }
          }}
        >
          <circle
            cx={p.x}
            cy={p.y}
            r={14}
            fill={p.team === 'own' ? '#22c55e' : '#ef4444'}
            stroke="white"
            strokeWidth={2}
            opacity={0.9}
          />
          {p.jerseyNumber !== null && (
            <text
              x={p.x}
              y={p.y + 4}
              textAnchor="middle"
              fill="white"
              fontSize={11}
              fontWeight="bold"
            >
              {p.jerseyNumber}
            </text>
          )}
        </g>
      ))}

      {/* Text labels */}
      {annotations.labels.map((l) => (
        <g key={l.id}>
          <rect
            x={l.x - 2}
            y={l.y - 12}
            width={l.text.length * 7 + 8}
            height={18}
            rx={3}
            fill="rgba(0,0,0,0.7)"
          />
          <text x={l.x + 2} y={l.y} fill="white" fontSize={12}>
            {l.text}
          </text>
        </g>
      ))}
    </svg>
  );
}
