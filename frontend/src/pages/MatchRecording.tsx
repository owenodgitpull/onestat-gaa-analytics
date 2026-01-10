import GAAPitch from '@/components/GAAPitch'
import { BallPosition } from '@/types'
import { useState } from 'react'

export default function MatchRecording() {
  const [ballPosition, setBallPosition] = useState<BallPosition | null>(null)

  return (
    <div className="space-y-6">
      <div className="glass-card p-6">
        <h1 className="text-3xl font-bold text-gradient mb-4">
          Live Match Recording
        </h1>
        <p className="text-white/60 mb-6">
          Tap the pitch to move the ball. Action buttons coming next!
        </p>
        
        <GAAPitch
          ballPosition={ballPosition}
          onBallMove={setBallPosition}
          showZones={true}
        />

        {ballPosition && (
          <div className="mt-4 glass-card p-4 text-sm">
            <p className="text-white/60">Ball Position:</p>
            <p className="text-white font-mono">
              X: {ballPosition.x.toFixed(1)}% | Y: {ballPosition.y.toFixed(1)}% | Team: {ballPosition.team}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

