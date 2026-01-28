import '@testing-library/jest-dom'

// Mock matchMedia for responsive components
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// Mock ResizeObserver for virtual scroll and responsive layouts
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock,
})

// Mock Range.getClientRects for CodeMirror (jsdom doesn't support it)
Range.prototype.getClientRects = function() {
  return {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  } as DOMRectList
}

Range.prototype.getBoundingClientRect = function() {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
  }
}

// Mock document.elementFromPoint for CodeMirror
document.elementFromPoint = function() {
  return null
}
