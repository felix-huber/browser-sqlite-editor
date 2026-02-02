import { describe, it, expect } from 'vitest'
import {
  quoteIdentifier,
  escapeLikePattern,
  makeColumnsUnique,
} from '../sql/helpers'

describe('quoteIdentifier', () => {
  describe('basic functionality', () => {
    it('wraps simple identifier in double quotes', () => {
      expect(quoteIdentifier('name')).toBe('"name"')
    })

    it('wraps identifier with underscore', () => {
      expect(quoteIdentifier('user_name')).toBe('"user_name"')
    })

    it('wraps identifier starting with number', () => {
      expect(quoteIdentifier('123column')).toBe('"123column"')
    })
  })

  describe('reserved words', () => {
    it('quotes SELECT', () => {
      expect(quoteIdentifier('SELECT')).toBe('"SELECT"')
    })

    it('quotes TABLE', () => {
      expect(quoteIdentifier('TABLE')).toBe('"TABLE"')
    })

    it('quotes lowercase reserved word', () => {
      expect(quoteIdentifier('select')).toBe('"select"')
    })

    it('quotes WHERE', () => {
      expect(quoteIdentifier('WHERE')).toBe('"WHERE"')
    })

    it('quotes FROM', () => {
      expect(quoteIdentifier('FROM')).toBe('"FROM"')
    })
  })

  describe('special characters', () => {
    it('handles spaces in identifier', () => {
      expect(quoteIdentifier('my column')).toBe('"my column"')
    })

    it('escapes embedded double quotes by doubling them', () => {
      expect(quoteIdentifier('col"name')).toBe('"col""name"')
    })

    it('handles multiple embedded quotes', () => {
      expect(quoteIdentifier('a"b"c')).toBe('"a""b""c"')
    })

    it('handles identifier that is just a quote', () => {
      expect(quoteIdentifier('"')).toBe('""""')
    })

    it('handles special SQL characters', () => {
      expect(quoteIdentifier("col'name")).toBe("\"col'name\"")
    })

    it('handles backticks', () => {
      expect(quoteIdentifier('col`name')).toBe('"col`name"')
    })

    it('handles brackets', () => {
      expect(quoteIdentifier('col[name]')).toBe('"col[name]"')
    })

    it('handles hyphens', () => {
      expect(quoteIdentifier('my-column')).toBe('"my-column"')
    })
  })

  describe('unicode identifiers', () => {
    it('handles unicode letters', () => {
      expect(quoteIdentifier('名前')).toBe('"名前"')
    })

    it('handles emoji', () => {
      expect(quoteIdentifier('col😀')).toBe('"col😀"')
    })

    it('handles accented characters', () => {
      expect(quoteIdentifier('café')).toBe('"café"')
    })

    it('handles mixed unicode and ASCII', () => {
      expect(quoteIdentifier('user_名前')).toBe('"user_名前"')
    })
  })

  describe('edge cases', () => {
    it('handles empty string', () => {
      expect(quoteIdentifier('')).toBe('""')
    })

    it('handles whitespace only', () => {
      expect(quoteIdentifier('   ')).toBe('"   "')
    })

    it('handles newline', () => {
      expect(quoteIdentifier('col\nname')).toBe('"col\nname"')
    })

    it('handles tab', () => {
      expect(quoteIdentifier('col\tname')).toBe('"col\tname"')
    })
  })
})

describe('escapeLikePattern', () => {
  describe('basic functionality', () => {
    it('returns unchanged string when no special characters', () => {
      expect(escapeLikePattern('hello')).toBe('hello')
    })

    it('escapes percent sign', () => {
      expect(escapeLikePattern('100%')).toBe('100\\%')
    })

    it('escapes underscore', () => {
      expect(escapeLikePattern('a_b')).toBe('a\\_b')
    })

    it('escapes backslash', () => {
      expect(escapeLikePattern('a\\b')).toBe('a\\\\b')
    })
  })

  describe('combined patterns', () => {
    it('escapes combined special characters', () => {
      expect(escapeLikePattern('50%_off\\')).toBe('50\\%\\_off\\\\')
    })

    it('handles multiple occurrences of same character', () => {
      expect(escapeLikePattern('%%')).toBe('\\%\\%')
      expect(escapeLikePattern('__')).toBe('\\_\\_')
      expect(escapeLikePattern('\\\\')).toBe('\\\\\\\\')
    })

    it('handles mixed content with special chars', () => {
      expect(escapeLikePattern('SELECT * FROM %table_name%')).toBe(
        'SELECT * FROM \\%table\\_name\\%'
      )
    })
  })

  describe('unicode', () => {
    it('preserves unicode characters', () => {
      expect(escapeLikePattern('café')).toBe('café')
    })

    it('handles unicode with special chars', () => {
      expect(escapeLikePattern('100%オフ')).toBe('100\\%オフ')
    })
  })

  describe('edge cases', () => {
    it('handles empty string', () => {
      expect(escapeLikePattern('')).toBe('')
    })

    it('handles string that is only special chars', () => {
      expect(escapeLikePattern('%_\\')).toBe('\\%\\_\\\\')
    })
  })

  describe('NULL handling', () => {
    it('returns null when given null', () => {
      expect(escapeLikePattern(null as unknown as string)).toBe(null)
    })

    it('returns undefined when given undefined', () => {
      expect(escapeLikePattern(undefined as unknown as string)).toBe(undefined)
    })
  })
})

describe('makeColumnsUnique', () => {
  describe('no duplicates', () => {
    it('returns unchanged array when no duplicates', () => {
      expect(makeColumnsUnique(['id', 'name', 'email'])).toEqual(['id', 'name', 'email'])
    })

    it('handles single column', () => {
      expect(makeColumnsUnique(['id'])).toEqual(['id'])
    })

    it('handles empty array', () => {
      expect(makeColumnsUnique([])).toEqual([])
    })
  })

  describe('with duplicates', () => {
    it('suffixes second occurrence of duplicate', () => {
      expect(makeColumnsUnique(['id', 'name', 'id'])).toEqual(['id', 'name', 'id_2'])
    })

    it('suffixes multiple duplicates with incrementing numbers', () => {
      expect(makeColumnsUnique(['id', 'id', 'id'])).toEqual(['id', 'id_2', 'id_3'])
    })

    it('handles multiple different duplicates', () => {
      expect(makeColumnsUnique(['id', 'name', 'id', 'name', 'id'])).toEqual([
        'id', 'name', 'id_2', 'name_2', 'id_3'
      ])
    })

    it('handles duplicates at beginning', () => {
      expect(makeColumnsUnique(['id', 'id', 'name'])).toEqual(['id', 'id_2', 'name'])
    })

    it('handles duplicates at end', () => {
      expect(makeColumnsUnique(['name', 'id', 'id'])).toEqual(['name', 'id', 'id_2'])
    })
  })

  describe('edge cases with existing suffixes', () => {
    it('handles column that already has _2 suffix', () => {
      // If input has id and id_2, and another id comes in, it should become id_3
      expect(makeColumnsUnique(['id', 'id_2', 'id'])).toEqual(['id', 'id_2', 'id_3'])
    })

    it('finds next available suffix when _2 is taken', () => {
      expect(makeColumnsUnique(['id', 'id', 'id_2'])).toEqual(['id', 'id_2', 'id_2_2'])
    })
  })

  describe('JOIN query scenarios', () => {
    it('handles typical JOIN with duplicate id columns', () => {
      const joinColumns = ['id', 'name', 'user_id', 'id', 'title', 'created_at']
      expect(makeColumnsUnique(joinColumns)).toEqual([
        'id', 'name', 'user_id', 'id_2', 'title', 'created_at'
      ])
    })

    it('handles three-table JOIN with duplicate columns', () => {
      const joinColumns = ['id', 'name', 'id', 'title', 'id', 'status']
      expect(makeColumnsUnique(joinColumns)).toEqual([
        'id', 'name', 'id_2', 'title', 'id_3', 'status'
      ])
    })
  })
})

