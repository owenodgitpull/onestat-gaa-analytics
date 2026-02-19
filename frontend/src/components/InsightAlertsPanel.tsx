import { useEffect, useState, useCallback } from 'react'
import { Sparkles } from 'lucide-react'
import { api } from '@/services/api'
import type { InsightAlert } from '@/services/api'
import InsightAlertCard from './InsightAlertCard'

interface InsightAlertsPanelProps {
  dashboard: 'season' | 'training'
}

export default function InsightAlertsPanel({ dashboard }: InsightAlertsPanelProps) {
  const [alerts, setAlerts] = useState<InsightAlert[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await api.ai.getInsightAlerts(dashboard)
      setAlerts(data)
    } catch {
      // Silent fail — don't break the page
    } finally {
      setLoading(false)
    }
  }, [dashboard])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  const handleDismiss = async (id: string) => {
    try {
      await api.ai.dismissInsightAlert(id)
      setAlerts(prev => prev.filter(a => a.id !== id))
    } catch {
      // Silent fail
    }
  }

  // Don't render anything if no alerts or still loading
  if (loading || alerts.length === 0) return null

  return (
    <div>
      <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-white">
        <Sparkles size={20} className="text-emerald-400" />
        AI Insight Alerts
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {alerts.map(alert => (
          <InsightAlertCard key={alert.id} alert={alert} onDismiss={handleDismiss} />
        ))}
      </div>
    </div>
  )
}
