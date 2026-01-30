import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Basic Vitest syntax demonstration
describe('Vitest Example', () => {
  it('should pass a basic assertion', () => {
    expect(1 + 1).toBe(2)
  })

  it('should work with arrays', () => {
    const items = ['a', 'b', 'c']
    expect(items).toHaveLength(3)
    expect(items).toContain('b')
  })
})

// Testing Library demonstration with a simple component
function Counter() {
  const [count, setCount] = React.useState(0)
  return (
    <div>
      <span data-testid="count">{count}</span>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
    </div>
  )
}

import React from 'react'

describe('Component Testing with Testing Library', () => {
  it('should render component', () => {
    render(<Counter />)
    expect(screen.getByTestId('count')).toHaveTextContent('0')
  })

  it('should handle user interactions', async () => {
    const user = userEvent.setup()
    render(<Counter />)

    const button = screen.getByRole('button', { name: /increment/i })
    await user.click(button)

    expect(screen.getByTestId('count')).toHaveTextContent('1')
  })
})
