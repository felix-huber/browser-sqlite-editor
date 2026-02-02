import { useState, useEffect, useCallback } from 'react'
import { debugLog } from '../utils/debug'

interface SWUpdateState {
  /** Whether an update is available */
  needsRefresh: boolean
  /** Function to apply the update (calls skipWaiting + reload) */
  updateServiceWorker: () => void
  /** Function to dismiss the notification */
  dismiss: () => void
}

// Key for storing dismissed version in localStorage
const DISMISSED_VERSION_KEY = 'sw-update-dismissed-version'

/**
 * Hook for managing service worker updates.
 * Uses vite-plugin-pwa's registerSW with 'prompt' registration type.
 */
export function useSWUpdate(): SWUpdateState {
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [updateSW, setUpdateSW] = useState<((reloadPage?: boolean) => Promise<void>) | null>(null)

  useEffect(() => {
    // Dynamic import to avoid SSR issues and only load when needed
    const registerServiceWorker = async () => {
      try {
        // vite-plugin-pwa generates this virtual module
        const { registerSW } = await import('virtual:pwa-register')

        const updateServiceWorker = registerSW({
          onNeedRefresh() {
            // Check if this version was already dismissed
            const currentVersion = document.documentElement.dataset.version || Date.now().toString()
            const dismissedVersion = localStorage.getItem(DISMISSED_VERSION_KEY)

            if (dismissedVersion !== currentVersion) {
              setNeedsRefresh(true)
            }
          },
          onOfflineReady() {
            // App is ready for offline use - could show a notification
            debugLog('[SW] App ready for offline use')
          },
          onRegistered(registration) {
            debugLog('[SW] Service worker registered:', registration)
          },
          onRegisterError(error) {
            console.error('[SW] Service worker registration failed:', error)
          },
        })

        setUpdateSW(() => updateServiceWorker)
      } catch (error) {
        // SW registration not available (e.g., in dev mode without HTTPS)
        console.warn('[SW] Service worker registration not available:', error)
      }
    }

    registerServiceWorker()
  }, [])

  const updateServiceWorker = useCallback(() => {
    if (updateSW) {
      // Call skipWaiting on the waiting service worker, then reload
      updateSW(true)
    }
  }, [updateSW])

  const dismiss = useCallback(() => {
    // Store current version as dismissed
    const currentVersion = document.documentElement.dataset.version || Date.now().toString()
    localStorage.setItem(DISMISSED_VERSION_KEY, currentVersion)
    setNeedsRefresh(false)
  }, [])

  return {
    needsRefresh,
    updateServiceWorker,
    dismiss,
  }
}
