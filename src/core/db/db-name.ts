/**
 * Database name validation and sanitization utilities.
 * Used by New Database dialog and Rename handler.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// Windows reserved device names (case-insensitive)
const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

// Allowed characters per PRD: alphanumeric, spaces, hyphens, underscores, dots, parentheses
const ALLOWED_CHARS_REGEX = /^[a-zA-Z0-9 \-_().]+$/;

// Maximum name length per PRD (1-64 chars)
const MAX_NAME_LENGTH = 64;

/**
 * Validates a database name for filesystem and security safety.
 */
export function validateDbName(name: string): ValidationResult {
  // Trim and check for empty
  const trimmed = name.trim();

  if (trimmed === '') {
    return { valid: false, error: 'Name cannot be empty' };
  }

  // Check max length (64 chars per PRD)
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { valid: false, error: 'Name too long (max 64 characters)' };
  }

  // Check for path separators
  if (trimmed.includes('/')) {
    return { valid: false, error: 'Name cannot contain /' };
  }
  if (trimmed.includes('\\')) {
    return { valid: false, error: 'Name cannot contain \\' };
  }

  // Check for hidden file prefix
  if (trimmed.startsWith('.')) {
    return { valid: false, error: 'Name cannot start with .' };
  }

  // Check for path traversal
  if (trimmed.includes('..')) {
    return { valid: false, error: 'Invalid name' };
  }

  // Check for reserved Windows names
  const upperName = trimmed.toUpperCase();
  // Also check with common extensions stripped (e.g., "CON.txt" is also reserved)
  const baseName = upperName.split('.')[0];
  if (RESERVED_NAMES.has(upperName) || RESERVED_NAMES.has(baseName)) {
    return { valid: false, error: 'Reserved name' };
  }

  // Check allowed characters
  if (!ALLOWED_CHARS_REGEX.test(trimmed)) {
    return { valid: false, error: 'Name contains invalid characters' };
  }

  return { valid: true };
}

/**
 * Sanitizes a database name by trimming whitespace.
 */
export function sanitizeDbName(name: string): string {
  return name.trim();
}

/**
 * Checks if a database name is available (not already in use).
 * Comparison is case-insensitive for cross-platform safety.
 */
export function isNameAvailable(name: string, existingNames: string[]): boolean {
  const normalizedName = name.trim().toLowerCase();
  return !existingNames.some(existing => existing.toLowerCase() === normalizedName);
}
