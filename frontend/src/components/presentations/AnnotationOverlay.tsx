/**
 * AnnotationOverlay — pure read-only renderer for a freeze-frame's drawn
 * shapes. Used by both AnnotationCanvasEditor (as the live drawing surface,
 * layered under interaction handling) and PresentMode (playback only).
 *
 * Shapes are plain data, coordinates as % of the video frame (0-100) — the
 * same percentage convention used everywhere else in the app for pitch
 * coordinates, so this SVG scales correctly at any display size without
 * ever needing to know the actual video's pixel dimensions.
 */

export type AnnotationShape =
  | { id: string; type: 'arrow'; points: [{ x: number; y: number }, { x: number; y: number }]; color: string }
  | { id: string; type: 'line'; points: [{ x: number; y: number }, { x: number; y: number }]; color: string }
  | { id: string; type: 'circle'; cx: number; cy: number; r: number; color: string }
  | { id: string; type: 'spotlight'; cx: number; cy: number; r: number; color: string }
  | { id: string; type: 'pencil'; points: { x: number; y: number }[]; color: string }
  | { id: string; type: 'text'; x: number; y: number; text: string; color: string }

export const ANNOTATION_COLORS = ['#FBBF24', '#EF4444', '#22C55E', '#3B82F6', '#FFFFFF'] as const

interface AnnotationOverlayProps {
  shapes: AnnotationShape[]
  selectedId?: string | null
  onSelect?: (id: string) => void
}

export default function AnnotationOverlay({ shapes, selectedId, onSelect }: AnnotationOverlayProps) {
  const spotlights = shapes.filter((s): s is Extract<AnnotationShape, { type: 'spotlight' }> => s.type === 'spotlight')

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full pointer-events-none"
    >
      <defs>
        <marker id="annotation-arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="context-stroke" />
        </marker>
        {spotlights.length > 0 && (
          <mask id="annotation-spotlight-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
            <rect x="0" y="0" width="100" height="100" fill="white" />
            {spotlights.map((s) => (
              <circle key={s.id} cx={s.cx} cy={s.cy} r={s.r} fill="black" />
            ))}
          </mask>
        )}
      </defs>

      {spotlights.length > 0 && (
        <rect x="0" y="0" width="100" height="100" fill="rgba(0,0,0,0.7)" mask="url(#annotation-spotlight-mask)" />
      )}

      {shapes.map((shape) => {
        const isSelected = shape.id === selectedId
        const handlers = onSelect
          ? { onClick: () => onSelect(shape.id), style: { pointerEvents: 'stroke' as const, cursor: 'pointer' } }
          : {}

        if (shape.type === 'arrow' || shape.type === 'line') {
          const [p1, p2] = shape.points
          return (
            <line
              key={shape.id}
              x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke={shape.color} strokeWidth={isSelected ? 0.9 : 0.6} vectorEffect="non-scaling-stroke"
              markerEnd={shape.type === 'arrow' ? 'url(#annotation-arrowhead)' : undefined}
              {...handlers}
            />
          )
        }
        if (shape.type === 'circle') {
          return (
            <circle
              key={shape.id} cx={shape.cx} cy={shape.cy} r={shape.r}
              fill="none" stroke={shape.color} strokeWidth={isSelected ? 0.9 : 0.6} vectorEffect="non-scaling-stroke"
              {...handlers}
            />
          )
        }
        if (shape.type === 'spotlight') {
          return (
            <circle
              key={shape.id} cx={shape.cx} cy={shape.cy} r={shape.r}
              fill="none" stroke={isSelected ? shape.color : 'none'} strokeWidth={0.6} strokeDasharray="1,1"
              vectorEffect="non-scaling-stroke"
              {...handlers}
            />
          )
        }
        if (shape.type === 'pencil') {
          const d = 'M ' + shape.points.map(p => `${p.x},${p.y}`).join(' L ')
          return (
            <path
              key={shape.id} d={d} fill="none" stroke={shape.color}
              strokeWidth={isSelected ? 0.9 : 0.6} strokeLinecap="round" strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              {...handlers}
            />
          )
        }
        // text
        return (
          <text
            key={shape.id} x={shape.x} y={shape.y} fill={shape.color}
            fontSize="4" fontWeight="700" style={{ paintOrder: 'stroke', ...handlers.style }}
            stroke="rgba(0,0,0,0.6)" strokeWidth={0.6}
            onClick={handlers.onClick}
          >
            {shape.text}
          </text>
        )
      })}
    </svg>
  )
}
