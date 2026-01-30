/**
 * Platform detection helpers.
 */

/**
 * Check if the current platform is macOS.
 */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.platform.includes('Mac') || navigator.userAgent.includes('Mac');
}
