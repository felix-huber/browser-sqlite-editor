import { useState, useCallback, useEffect, type ChangeEvent } from 'react'

/** Maximum allowed limit value */
const MAX_LIMIT = 1_000_000

/** Preset limit values */
const PRESETS = [10, 100, 1000] as const

export interface LimitControlProps {
  /** Current limit value (null = no limit) */
  limit: number | null
  /** Callback when limit changes */
  onLimitChange: (limit: number | null) => void
  /** Whether the control is disabled */
  disabled?: boolean
}

/**
 * LIMIT control for the query builder.
 * Provides a number input with validation, enable/disable toggle,
 * preset buttons, and a clear button.
 */
export function LimitControl({ limit, onLimitChange, disabled = false }: LimitControlProps) {
  // Local input value (string to allow empty state during typing)
  const [inputValue, setInputValue] = useState<string>(limit?.toString() ?? '100')
  const [error, setError] = useState<string | null>(null)

  // Sync input value when limit prop changes externally
  useEffect(() => {
    if (limit !== null) {
      setInputValue(limit.toString())
      setError(null)
    }
  }, [limit])

  // Whether the limit is enabled (not null)
  const isEnabled = limit !== null

  // Validate and parse input value
  const validateAndSet = useCallback((value: string): { valid: boolean; parsed: number | null } => {
    // Empty input
    if (!value.trim()) {
      return { valid: false, parsed: null }
    }

    // Check for non-integer characters
    if (!/^\d+$/.test(value)) {
      return { valid: false, parsed: null }
    }

    const parsed = parseInt(value, 10)

    // Must be positive integer
    if (parsed <= 0) {
      return { valid: false, parsed: null }
    }

    // Must not exceed max
    if (parsed > MAX_LIMIT) {
      return { valid: false, parsed: null }
    }

    return { valid: true, parsed }
  }, [])

  // Handle input change
  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)

    if (!value.trim()) {
      setError('Value required')
      return
    }

    const { valid, parsed } = validateAndSet(value)

    if (!valid) {
      if (!/^\d+$/.test(value)) {
        setError('Must be a positive integer')
      } else {
        const num = parseInt(value, 10)
        if (num <= 0) {
          setError('Must be greater than 0')
        } else if (num > MAX_LIMIT) {
          setError(`Maximum is ${MAX_LIMIT.toLocaleString()}`)
        }
      }
      return
    }

    setError(null)
    onLimitChange(parsed)
  }, [validateAndSet, onLimitChange])

  // Handle enable/disable toggle
  const handleToggle = useCallback(() => {
    if (isEnabled) {
      // Disable limit
      onLimitChange(null)
    } else {
      // Enable limit with current input value or default
      const { valid, parsed } = validateAndSet(inputValue)
      onLimitChange(valid ? parsed : 100)
      if (!valid) {
        setInputValue('100')
        setError(null)
      }
    }
  }, [isEnabled, inputValue, validateAndSet, onLimitChange])

  // Handle preset button click
  const handlePreset = useCallback((value: number) => {
    setInputValue(value.toString())
    setError(null)
    onLimitChange(value)
  }, [onLimitChange])

  // Handle clear button click
  const handleClear = useCallback(() => {
    setInputValue('')
    setError('Value required')
  }, [])

  return (
    <div
      className="flex flex-col gap-2 p-3 bg-white border border-navy-200 rounded-lg"
      data-testid="limit-control"
    >
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={handleToggle}
            disabled={disabled}
            className="w-4 h-4 rounded border-navy-300 text-navy-600 focus:ring-navy-500 cursor-pointer disabled:cursor-not-allowed"
            data-testid="limit-toggle"
          />
          <span className="text-sm font-medium text-navy-700">Limit results</span>
        </label>
      </div>

      {/* Warning when disabled */}
      {!isEnabled && (
        <div
          className="text-xs text-amber-600 bg-amber-50 px-2 py-1.5 rounded"
          data-testid="limit-warning"
        >
          Query may return many rows
        </div>
      )}

      {/* Input and controls (only shown when enabled) */}
      {isEnabled && (
        <div className="flex flex-col gap-2">
          {/* Input row */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                inputMode="numeric"
                value={inputValue}
                onChange={handleInputChange}
                disabled={disabled}
                className={`
                  w-full px-3 py-1.5 text-sm border rounded
                  focus:outline-none focus:ring-2
                  disabled:bg-navy-50 disabled:cursor-not-allowed
                  ${error
                    ? 'border-red-400 focus:ring-red-200 focus:border-red-400'
                    : 'border-navy-200 focus:ring-navy-200 focus:border-navy-600'
                  }
                `}
                placeholder="Enter limit..."
                data-testid="limit-input"
              />
            </div>
            <button
              onClick={handleClear}
              disabled={disabled || !inputValue}
              className="px-2 py-1.5 text-xs font-medium text-navy-500 hover:text-navy-700 hover:bg-navy-100 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Clear value"
              data-testid="limit-clear"
            >
              Clear
            </button>
          </div>

          {/* Error message */}
          {error && (
            <div
              className="text-xs text-red-600"
              data-testid="limit-error"
            >
              {error}
            </div>
          )}

          {/* Preset buttons */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-navy-500">Quick:</span>
            {PRESETS.map((preset) => (
              <button
                key={preset}
                onClick={() => handlePreset(preset)}
                disabled={disabled}
                className={`
                  px-2 py-1 text-xs font-medium rounded transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed
                  ${limit === preset
                    ? 'bg-navy-600 text-white'
                    : 'bg-navy-100 text-navy-600 hover:bg-navy-200'
                  }
                `}
                data-testid={`limit-preset-${preset}`}
              >
                {preset.toLocaleString()}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default LimitControl
