import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LimitControl } from '../LimitControl'

describe('LimitControl', () => {
  it('renders with initial state: LIMIT 100 enabled', () => {
    const onLimitChange = vi.fn()
    render(<LimitControl limit={100} onLimitChange={onLimitChange} />)

    // Toggle should be checked
    const toggle = screen.getByTestId('limit-toggle')
    expect(toggle).toBeChecked()

    // Input should show 100
    const input = screen.getByTestId('limit-input')
    expect(input).toHaveValue('100')

    // No warning should be shown
    expect(screen.queryByTestId('limit-warning')).not.toBeInTheDocument()
  })

  it('updates value when typing 50', () => {
    const onLimitChange = vi.fn()
    render(<LimitControl limit={100} onLimitChange={onLimitChange} />)

    const input = screen.getByTestId('limit-input')
    fireEvent.change(input, { target: { value: '50' } })

    expect(onLimitChange).toHaveBeenCalledWith(50)
  })

  it('updates value when clicking preset 1000', () => {
    const onLimitChange = vi.fn()
    render(<LimitControl limit={100} onLimitChange={onLimitChange} />)

    const preset1000 = screen.getByTestId('limit-preset-1000')
    fireEvent.click(preset1000)

    expect(onLimitChange).toHaveBeenCalledWith(1000)
  })

  it('sets limit to null when disabling checkbox', () => {
    const onLimitChange = vi.fn()
    render(<LimitControl limit={100} onLimitChange={onLimitChange} />)

    const toggle = screen.getByTestId('limit-toggle')
    fireEvent.click(toggle)

    expect(onLimitChange).toHaveBeenCalledWith(null)
  })

  it('shows error for invalid negative input', () => {
    const onLimitChange = vi.fn()
    render(<LimitControl limit={100} onLimitChange={onLimitChange} />)

    const input = screen.getByTestId('limit-input')
    fireEvent.change(input, { target: { value: '-5' } })

    // Error should be shown
    const error = screen.getByTestId('limit-error')
    expect(error).toBeInTheDocument()
    expect(error).toHaveTextContent('Must be a positive integer')

    // onLimitChange should NOT be called with invalid value
    expect(onLimitChange).not.toHaveBeenCalled()
  })

  it('shows error for invalid decimal input', () => {
    const onLimitChange = vi.fn()
    render(<LimitControl limit={100} onLimitChange={onLimitChange} />)

    const input = screen.getByTestId('limit-input')
    fireEvent.change(input, { target: { value: '10.5' } })

    // Error should be shown
    const error = screen.getByTestId('limit-error')
    expect(error).toBeInTheDocument()
    expect(error).toHaveTextContent('Must be a positive integer')

    // onLimitChange should NOT be called with invalid value
    expect(onLimitChange).not.toHaveBeenCalled()
  })

  it('clears input when clicking Clear button', () => {
    const onLimitChange = vi.fn()
    render(<LimitControl limit={100} onLimitChange={onLimitChange} />)

    const clearButton = screen.getByTestId('limit-clear')
    fireEvent.click(clearButton)

    // Input should be empty
    const input = screen.getByTestId('limit-input')
    expect(input).toHaveValue('')

    // Error should be shown for empty input
    const error = screen.getByTestId('limit-error')
    expect(error).toHaveTextContent('Value required')
  })

  it('shows warning when limit is disabled', () => {
    const onLimitChange = vi.fn()
    render(<LimitControl limit={null} onLimitChange={onLimitChange} />)

    // Toggle should be unchecked
    const toggle = screen.getByTestId('limit-toggle')
    expect(toggle).not.toBeChecked()

    // Warning should be shown
    const warning = screen.getByTestId('limit-warning')
    expect(warning).toBeInTheDocument()
    expect(warning).toHaveTextContent('Query may return many rows')

    // Input should not be visible when disabled
    expect(screen.queryByTestId('limit-input')).not.toBeInTheDocument()
  })

  it('enables limit with default 100 when toggling on with empty input', () => {
    const onLimitChange = vi.fn()
    const { rerender } = render(<LimitControl limit={null} onLimitChange={onLimitChange} />)

    // Toggle on
    const toggle = screen.getByTestId('limit-toggle')
    fireEvent.click(toggle)

    expect(onLimitChange).toHaveBeenCalledWith(100)

    // Rerender with new limit value
    rerender(<LimitControl limit={100} onLimitChange={onLimitChange} />)

    // Input should show 100
    const input = screen.getByTestId('limit-input')
    expect(input).toHaveValue('100')
  })

  it('highlights active preset button', () => {
    const onLimitChange = vi.fn()
    render(<LimitControl limit={100} onLimitChange={onLimitChange} />)

    // 100 preset should have active styling
    const preset100 = screen.getByTestId('limit-preset-100')
    expect(preset100).toHaveClass('bg-navy-600', 'text-white')

    // Other presets should have inactive styling
    const preset10 = screen.getByTestId('limit-preset-10')
    expect(preset10).toHaveClass('bg-navy-100')
    expect(preset10).not.toHaveClass('bg-navy-600')

    const preset1000 = screen.getByTestId('limit-preset-1000')
    expect(preset1000).toHaveClass('bg-navy-100')
    expect(preset1000).not.toHaveClass('bg-navy-600')
  })

  it('shows error for zero value', () => {
    const onLimitChange = vi.fn()
    render(<LimitControl limit={100} onLimitChange={onLimitChange} />)

    const input = screen.getByTestId('limit-input')
    fireEvent.change(input, { target: { value: '0' } })

    // Error should be shown
    const error = screen.getByTestId('limit-error')
    expect(error).toHaveTextContent('Must be greater than 0')

    // onLimitChange should NOT be called
    expect(onLimitChange).not.toHaveBeenCalled()
  })

  it('shows error when exceeding max limit', () => {
    const onLimitChange = vi.fn()
    render(<LimitControl limit={100} onLimitChange={onLimitChange} />)

    const input = screen.getByTestId('limit-input')
    fireEvent.change(input, { target: { value: '2000000' } })

    // Error should be shown (using regex to match locale-independent number format)
    const error = screen.getByTestId('limit-error')
    expect(error.textContent).toMatch(/Maximum is 1[,.]000[,.]000/)

    // onLimitChange should NOT be called
    expect(onLimitChange).not.toHaveBeenCalled()
  })

  it('disables controls when disabled prop is true', () => {
    const onLimitChange = vi.fn()
    render(<LimitControl limit={100} onLimitChange={onLimitChange} disabled />)

    const toggle = screen.getByTestId('limit-toggle')
    const input = screen.getByTestId('limit-input')
    const clearButton = screen.getByTestId('limit-clear')
    const preset10 = screen.getByTestId('limit-preset-10')

    expect(toggle).toBeDisabled()
    expect(input).toBeDisabled()
    expect(clearButton).toBeDisabled()
    expect(preset10).toBeDisabled()
  })

  it('syncs input value when limit prop changes externally', () => {
    const onLimitChange = vi.fn()
    const { rerender } = render(<LimitControl limit={100} onLimitChange={onLimitChange} />)

    // Verify initial value
    const input = screen.getByTestId('limit-input')
    expect(input).toHaveValue('100')

    // Rerender with new limit
    rerender(<LimitControl limit={500} onLimitChange={onLimitChange} />)

    // Input should update
    expect(input).toHaveValue('500')
  })
})
