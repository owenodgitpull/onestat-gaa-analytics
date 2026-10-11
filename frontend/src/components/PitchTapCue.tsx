/**
 * "A tap on the pitch is needed" cue - a pulsing frame, pulsing dots across the pitch and a large label.
 *
 * The banner over the video is easy to miss when the coach's eyes are on the pitch, so the pitch itself says it too.
 * Purely visual: pointer-events are off, so it never takes the tap. Drop it inside any `relative` pitch container.
 * Used by Live Recording (normal + fullscreen) and Video Tagging for the kickout-landing / 45m-line / long-ball taps.
 */
const DOT_X = [10, 30, 50, 70, 90]
const DOT_Y = [25, 50, 75]

export default function PitchTapCue({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden" aria-hidden="true">
      <div
        className="absolute inset-1 rounded-xl border-4 border-amber-400/90 animate-pulse"
        style={{ boxShadow: 'inset 0 0 40px 6px rgba(251,191,36,0.35), 0 0 24px 4px rgba(251,191,36,0.4)' }}
      />
      {DOT_X.flatMap((x, xi) => DOT_Y.map((y, yi) => (
        <span
          key={`${x}-${y}`}
          className="absolute"
          style={{ left: `${x}%`, top: `${y}%`, width: 14, height: 14, marginLeft: -7, marginTop: -7 }}
        >
          <span
            className="absolute inset-0 rounded-full bg-amber-300/70 animate-ping"
            style={{ animationDelay: `${((xi + yi) % 5) * 0.2}s`, animationDuration: '1.6s' }}
          />
          <span className="absolute inset-[3px] rounded-full bg-amber-300/90" />
        </span>
      )))}
      <div className="absolute left-1/2 top-3 -translate-x-1/2 px-5 py-2 rounded-2xl bg-amber-400 text-black font-extrabold tracking-wide text-base md:text-xl shadow-2xl animate-pulse whitespace-nowrap">
        {label}
      </div>
    </div>
  )
}
