import { describe, it, expect } from 'vitest'
import { escapeLike, getEscapeClause } from '../sql/escape'

describe('escapeLike', () => {
  it('returns unchanged string when no special characters', () => {
    expect(escapeLike('hello')).toBe('hello')
  })

  it('escapes percent sign', () => {
    expect(escapeLike('100%')).toBe('100\\%')
  })

  it('escapes underscore', () => {
    expect(escapeLike('a_b')).toBe('a\\_b')
  })

  it('escapes backslash', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b')
  })

  it('escapes combined special characters', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\')
  })

  it('handles empty string', () => {
    expect(escapeLike('')).toBe('')
  })

  it('preserves unicode characters', () => {
    expect(escapeLike('cafe')).toBe('cafe')
  })

  it('handles multiple occurrences of same character', () => {
    expect(escapeLike('%%')).toBe('\\%\\%')
    expect(escapeLike('__')).toBe('\\_\\_')
    expect(escapeLike('\\\\')).toBe('\\\\\\\\')
  })

  it('handles mixed content with special chars', () => {
    expect(escapeLike('SELECT * FROM %table_name%')).toBe(
      'SELECT * FROM \\%table\\_name\\%'
    )
  })

  it('escapeLike supports custom escape character', () => {
    expect(escapeLike('100%', '!')).toBe('100!%')
    expect(escapeLike('a_b', '!')).toBe('a!_b')
    expect(escapeLike('a!b', '!')).toBe('a!!b')
  })
})

describe('getEscapeClause', () => {
  it('returns default escape clause with backslash', () => {
    expect(getEscapeClause()).toBe("ESCAPE '\\'")
  })

  it('getEscapeClause supports custom escape character', () => {
    expect(getEscapeClause('!')).toBe("ESCAPE '!'")
  })

  it('escapes single quotes in escape character', () => {
    expect(getEscapeClause("'")).toBe("ESCAPE ''''")
  })
})
