/**
 * Mock for virtual:pwa-register module used in tests
 */

type RegisterSWOptions = {
  immediate?: boolean
  onNeedRefresh?: () => void
  onOfflineReady?: () => void
  onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void
  onRegisterError?: (error: Error) => void
}

// Store callbacks so tests can trigger them
let storedOnNeedRefresh: (() => void) | null = null
let storedOnOfflineReady: (() => void) | null = null

export function registerSW(options: RegisterSWOptions = {}): (reloadPage?: boolean) => Promise<void> {
  // Store callbacks for test access
  storedOnNeedRefresh = options.onNeedRefresh ?? null
  storedOnOfflineReady = options.onOfflineReady ?? null

  // Call onRegistered immediately with undefined (simulating no registration)
  options.onRegistered?.(undefined)

  // Return a mock update function
  return async (_reloadPage?: boolean) => {
    // Mock implementation - do nothing in tests
  }
}

// Test utilities to trigger callbacks
export function __triggerNeedRefresh() {
  storedOnNeedRefresh?.()
}

export function __triggerOfflineReady() {
  storedOnOfflineReady?.()
}

export function __reset() {
  storedOnNeedRefresh = null
  storedOnOfflineReady = null
}
