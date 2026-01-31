import { describe, it, expect } from 'vitest'
import {
  quoteIdentifier,
  escapeLikePattern,
  generateAlias,
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
})

describe('generateAlias', () => {
  describe('basic functionality', () => {
    it('returns Table.Column format', () => {
      expect(generateAlias('users', 'name')).toBe('users.name')
    })

    it('handles different table and column names', () => {
      expect(generateAlias('orders', 'id')).toBe('orders.id')
    })

    it('handles underscores in names', () => {
      expect(generateAlias('user_roles', 'role_id')).toBe('user_roles.role_id')
    })
  })

  describe('special characters', () => {
    it('handles spaces in table name', () => {
      expect(generateAlias('my table', 'col')).toBe('my table.col')
    })

    it('handles spaces in column name', () => {
      expect(generateAlias('table', 'my col')).toBe('table.my col')
    })

    it('handles dots in names (does not escape)', () => {
      expect(generateAlias('schema.table', 'col')).toBe('schema.table.col')
    })
  })

  describe('reserved words', () => {
    it('handles reserved word as table', () => {
      expect(generateAlias('SELECT', 'id')).toBe('SELECT.id')
    })

    it('handles reserved word as column', () => {
      expect(generateAlias('users', 'TABLE')).toBe('users.TABLE')
    })
  })

  describe('unicode', () => {
    it('handles unicode table name', () => {
      expect(generateAlias('ユーザー', 'name')).toBe('ユーザー.name')
    })

    it('handles unicode column name', () => {
      expect(generateAlias('users', '名前')).toBe('users.名前')
    })
  })

  describe('edge cases', () => {
    it('handles empty table name', () => {
      expect(generateAlias('', 'col')).toBe('.col')
    })

    it('handles empty column name', () => {
      expect(generateAlias('table', '')).toBe('table.')
    })

    it('handles both empty', () => {
      expect(generateAlias('', '')).toBe('.')
    })
  })
})
