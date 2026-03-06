import { useCallback, useEffect, useRef, useState } from 'react'
import { driver, type DriveStep } from 'driver.js'

const STORAGE_KEY = 'gaa-tours-completed'

function getCompleted(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function markComplete(tourId: string) {
  const completed = getCompleted()
  completed[tourId] = true
  localStorage.setItem(STORAGE_KEY, JSON.stringify(completed))
}

export function resetTour(tourId: string) {
  const completed = getCompleted()
  delete completed[tourId]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(completed))
}

export function resetAllTours() {
  localStorage.removeItem(STORAGE_KEY)
}

export function isTourCompleted(tourId: string): boolean {
  return !!getCompleted()[tourId]
}

export function useTour(tourId: string, steps: DriveStep[]) {
  const [isActive, setIsActive] = useState(false)
  const driverRef = useRef<ReturnType<typeof driver> | null>(null)

  const startTour = useCallback((force = false) => {
    if (!force && isTourCompleted(tourId)) return
    if (isActive) return

    // Delay to let DOM settle after page transitions
    setTimeout(() => {
      // Filter steps to only those whose element exists in DOM (or have no element)
      const validSteps = steps.filter(step => {
        if (!step.element) return true
        const selector = typeof step.element === 'string' ? step.element : null
        if (!selector) return true
        const el = document.querySelector(selector)
        return el !== null
      })

      if (validSteps.length === 0) return

      const d = driver({
        showProgress: true,
        animate: true,
        overlayColor: 'rgba(0, 0, 0, 0.7)',
        stagePadding: 8,
        stageRadius: 8,
        popoverClass: 'driver-popover',
        steps: validSteps,
        onDestroyed: () => {
          markComplete(tourId)
          setIsActive(false)
          driverRef.current = null
        },
      })

      driverRef.current = d
      setIsActive(true)
      d.drive()
    }, 600)
  }, [tourId, steps, isActive])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (driverRef.current) {
        driverRef.current.destroy()
        driverRef.current = null
      }
    }
  }, [])

  return { startTour, isActive, isTourCompleted: isTourCompleted(tourId) }
}
