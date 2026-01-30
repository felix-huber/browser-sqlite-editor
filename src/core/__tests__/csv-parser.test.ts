import { describe, it, expect } from 'vitest'
import { parseCSVString, parseCSVFile, parseCSVBytes, serializeToCSV, type ColumnDef } from '../io/csv'

describe('CSV Parser', () => {
  describe('parseCSVString', () => {
    it('should parse simple CSV with columns and rows correctly', () => {
      const csv = `name,age,city
Alice,30,NYC
Bob,25,LA`

      const result = parseCSVString(csv)

      expect(result.hasHeader).toBe(true)
      expect(result.columns).toHaveLength(3)
      expect(result.columns[0].name).toBe('name')
      expect(result.columns[1].name).toBe('age')
      expect(result.columns[2].name).toBe('city')
      expect(result.rows).toHaveLength(2)
      expect(result.rows[0]).toEqual(['Alice', 30, 'NYC'])
      expect(result.rows[1]).toEqual(['Bob', 25, 'LA'])
    })

    it('should detect semicolon delimiter', () => {
      const csv = `name;age;city
Alice;30;NYC
Bob;25;LA`

      const result = parseCSVString(csv)

      expect(result.columns).toHaveLength(3)
      expect(result.columns[0].name).toBe('name')
      expect(result.columns[1].name).toBe('age')
      expect(result.rows[0]).toEqual(['Alice', 30, 'NYC'])
    })

    it('should detect tab delimiter', () => {
      const csv = `name\tage\tcity
Alice\t30\tNYC
Bob\t25\tLA`

      const result = parseCSVString(csv)

      expect(result.columns).toHaveLength(3)
      expect(result.columns[0].name).toBe('name')
      expect(result.rows[0]).toEqual(['Alice', 30, 'NYC'])
    })

    it('should infer INTEGER type for integer columns', () => {
      const csv = `id,count
1,100
2,200
3,300`

      const result = parseCSVString(csv)

      expect(result.columns[0].type).toBe('INTEGER')
      expect(result.columns[1].type).toBe('INTEGER')
      expect(result.rows[0][0]).toBe(1)
      expect(result.rows[0][1]).toBe(100)
    })

    it('should infer REAL type for decimal columns', () => {
      const csv = `item,price
Apple,1.99
Banana,0.50`

      const result = parseCSVString(csv)

      expect(result.columns[1].type).toBe('REAL')
      expect(result.rows[0][1]).toBe(1.99)
      expect(result.rows[1][1]).toBe(0.5)
    })

    it('should infer TEXT type for mixed columns', () => {
      const csv = `data
hello
123
world`

      const result = parseCSVString(csv)

      expect(result.columns[0].type).toBe('TEXT')
    })

    it('should preserve spaces in headers (for identifier quoting)', () => {
      const csv = `First Name,Last Name,Email Address
Alice,Smith,alice@example.com`

      const result = parseCSVString(csv)

      expect(result.columns[0].name).toBe('First Name')
      expect(result.columns[0].originalName).toBe('First Name')
      expect(result.columns[1].name).toBe('Last Name')
      expect(result.columns[2].name).toBe('Email Address')
    })

    it('should auto-suffix duplicate headers case-insensitively', () => {
      const csv = `name,Name,NAME,other
Alice,Bob,Charlie,value`

      const result = parseCSVString(csv)

      expect(result.columns[0].name).toBe('name')
      expect(result.columns[1].name).toBe('Name_1')
      expect(result.columns[2].name).toBe('NAME_2')
      expect(result.columns[3].name).toBe('other')
    })

    it('should handle duplicate headers with spaces', () => {
      const csv = `My Column,my column,Another
a,b,c`

      const result = parseCSVString(csv)

      expect(result.columns[0].name).toBe('My Column')
      expect(result.columns[1].name).toBe('my column_1')
      expect(result.columns[2].name).toBe('Another')
    })

    it('should avoid collision when suffixed name already exists', () => {
      // 'name_1' already exists, so 'Name' duplicate should become 'name_2' not 'Name_1'
      const csv = `name,name_1,Name,other
a,b,c,d`

      const result = parseCSVString(csv)

      expect(result.columns[0].name).toBe('name')
      expect(result.columns[1].name).toBe('name_1')
      expect(result.columns[2].name).toBe('Name_2') // skips _1 since it exists
      expect(result.columns[3].name).toBe('other')
    })

    it('should normalize header: trim whitespace', () => {
      const csv = `  name  ,  age
Alice,30`

      const result = parseCSVString(csv)

      expect(result.columns[0].name).toBe('name')
      expect(result.columns[1].name).toBe('age')
    })

    it('should replace empty headers with column_N', () => {
      const csv = `name,,city
Alice,30,NYC`

      const result = parseCSVString(csv)

      expect(result.columns[0].name).toBe('name')
      expect(result.columns[1].name).toBe('column_2')
      expect(result.columns[2].name).toBe('city')
    })

    it('should handle quoted fields correctly', () => {
      const csv = `name,description
"John Doe","A ""great"" person"
"Jane, Smith","Works at Acme, Inc."`

      const result = parseCSVString(csv)

      expect(result.rows[0][0]).toBe('John Doe')
      expect(result.rows[0][1]).toBe('A "great" person')
      expect(result.rows[1][0]).toBe('Jane, Smith')
      expect(result.rows[1][1]).toBe('Works at Acme, Inc.')
    })

    it('should handle newlines in quoted fields', () => {
      const csv = `name,address
"Alice","123 Main St
Apt 4"`

      const result = parseCSVString(csv)

      expect(result.rows[0][1]).toBe('123 Main St\nApt 4')
    })

    it('should strip UTF-8 BOM from first cell', () => {
      const bom = '\uFEFF'
      const csv = `${bom}name,age
Alice,30`

      const result = parseCSVString(csv)

      expect(result.columns[0].name).toBe('name')
      expect(result.columns[0].originalName).toBe('name')
    })

    it('should handle empty file', () => {
      const csv = ''

      const result = parseCSVString(csv)

      expect(result.columns).toHaveLength(0)
      expect(result.rows).toHaveLength(0)
    })

    it('should handle whitespace-only file', () => {
      const csv = '   \n\n  '

      const result = parseCSVString(csv)

      expect(result.columns).toHaveLength(0)
      expect(result.rows).toHaveLength(0)
    })

    it('should handle single column', () => {
      const csv = `names
Alice
Bob
Charlie`

      const result = parseCSVString(csv)

      expect(result.columns).toHaveLength(1)
      expect(result.columns[0].name).toBe('names')
      expect(result.rows).toHaveLength(3)
      expect(result.rows[0]).toEqual(['Alice'])
    })

    it('should pad shorter rows with null', () => {
      const csv = `a,b,c
1,2,3
4,5
6`

      const result = parseCSVString(csv)

      expect(result.columns).toHaveLength(3)
      expect(result.rows[0]).toEqual([1, 2, 3])
      expect(result.rows[1]).toEqual([4, 5, null])
      expect(result.rows[2]).toEqual([6, null, null])
    })

    it('should truncate longer rows to header width', () => {
      const csv = `a,b
1,2,3,4`

      const result = parseCSVString(csv)

      // Max width is 4 (from data row), so header gets padded
      expect(result.columns).toHaveLength(4)
      expect(result.columns[2].name).toBe('column_3')
      expect(result.columns[3].name).toBe('column_4')
    })

    it('should detect no header when first row has numeric values', () => {
      const csv = `1,2,3
4,5,6
7,8,9`

      const result = parseCSVString(csv)

      expect(result.hasHeader).toBe(false)
      expect(result.columns[0].name).toBe('column_1')
      expect(result.rows).toHaveLength(3)
      expect(result.rows[0]).toEqual([1, 2, 3])
    })

    it('should handle null/empty values in data', () => {
      const csv = `name,age,city
Alice,,NYC
,25,`

      const result = parseCSVString(csv)

      expect(result.rows[0]).toEqual(['Alice', null, 'NYC'])
      expect(result.rows[1]).toEqual([null, 25, null])
    })

    it('should handle very long text values', () => {
      const longText = 'a'.repeat(10000)
      const csv = `text\n${longText}`

      const result = parseCSVString(csv)

      expect(result.rows[0][0]).toBe(longText)
    })
  })

  describe('parseCSVFile', () => {
    it('should parse file with streaming', async () => {
      const csvContent = `name,age,city
Alice,30,NYC
Bob,25,LA`

      const file = new File([csvContent], 'test.csv', { type: 'text/csv' })
      const result = await parseCSVFile(file)

      expect(result.columns).toHaveLength(3)
      expect(result.rows).toHaveLength(2)
      expect(result.rows[0]).toEqual(['Alice', 30, 'NYC'])
    })

    it('should strip BOM from file', async () => {
      const bom = '\uFEFF'
      const csvContent = `${bom}name,age
Alice,30`

      const file = new File([csvContent], 'test.csv', { type: 'text/csv' })
      const result = await parseCSVFile(file)

      expect(result.columns[0].name).toBe('name')
    })

    it('should handle large file (10k rows)', async () => {
      const header = 'id,value'
      const rows = Array.from({ length: 10000 }, (_, i) => `${i},${i * 2}`)
      const csvContent = [header, ...rows].join('\n')

      const file = new File([csvContent], 'large.csv', { type: 'text/csv' })
      const result = await parseCSVFile(file)

      expect(result.columns).toHaveLength(2)
      expect(result.rows).toHaveLength(10000)
      expect(result.rows[0]).toEqual([0, 0])
      expect(result.rows[9999]).toEqual([9999, 19998])
    })

    it('should handle empty file', async () => {
      const file = new File([''], 'empty.csv', { type: 'text/csv' })
      const result = await parseCSVFile(file)

      expect(result.columns).toHaveLength(0)
      expect(result.rows).toHaveLength(0)
    })

    it('should reject non-UTF-8 file', async () => {
      // Latin-1 encoded bytes with characters that are invalid in UTF-8
      const invalidUtf8 = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x80, 0xff, 0x0a])
      const file = new File([invalidUtf8], 'invalid.csv', { type: 'text/csv' })

      await expect(parseCSVFile(file)).rejects.toThrow('non-UTF-8')
    })
  })

  describe('parseCSVBytes', () => {
    it('should reject non-UTF-8 files', () => {
      // Latin-1 encoded bytes with characters that are invalid in UTF-8
      // 0x80-0xFF in isolation are invalid UTF-8 sequences
      const invalidUtf8 = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x80, 0xff, 0x0a]) // "hello" + invalid bytes

      expect(() => parseCSVBytes(invalidUtf8)).toThrow('non-UTF-8')
    })

    it('should accept valid UTF-8 files', () => {
      const validUtf8 = new TextEncoder().encode('name,age\nAlice,30')
      const result = parseCSVBytes(validUtf8)

      expect(result.columns).toHaveLength(2)
      expect(result.columns[0].name).toBe('name')
    })

    it('should accept UTF-8 with BOM', () => {
      const bom = new Uint8Array([0xef, 0xbb, 0xbf]) // UTF-8 BOM
      const content = new TextEncoder().encode('name,age\nAlice,30')
      const withBom = new Uint8Array([...bom, ...content])

      const result = parseCSVBytes(withBom)

      expect(result.columns[0].name).toBe('name')
    })
  })

  describe('serializeToCSV', () => {
    it('should serialize columns and rows to CSV string', () => {
      const columns: ColumnDef[] = [
        { name: 'name', type: 'TEXT', originalName: 'name' },
        { name: 'age', type: 'INTEGER', originalName: 'age' },
      ]
      const rows = [
        ['Alice', 30],
        ['Bob', 25],
      ]

      const csv = serializeToCSV(columns, rows)

      expect(csv).toBe('name,age\r\nAlice,30\r\nBob,25')
    })

    it('should handle null values', () => {
      const columns: ColumnDef[] = [
        { name: 'name', type: 'TEXT', originalName: 'name' },
        { name: 'age', type: 'INTEGER', originalName: 'age' },
      ]
      const rows = [
        ['Alice', null],
        [null, 25],
      ]

      const csv = serializeToCSV(columns, rows)

      expect(csv).toBe('name,age\r\nAlice,\r\n,25')
    })

    it('should exclude header when includeHeader is false', () => {
      const columns: ColumnDef[] = [
        { name: 'name', type: 'TEXT', originalName: 'name' },
      ]
      const rows = [['Alice'], ['Bob']]

      const csv = serializeToCSV(columns, rows, false)

      expect(csv).toBe('Alice\r\nBob')
    })

    it('should properly quote values with commas', () => {
      const columns: ColumnDef[] = [
        { name: 'name', type: 'TEXT', originalName: 'name' },
      ]
      const rows = [['Alice, Bob']]

      const csv = serializeToCSV(columns, rows)

      expect(csv).toBe('name\r\n"Alice, Bob"')
    })

    it('should properly escape quotes in values', () => {
      const columns: ColumnDef[] = [
        { name: 'quote', type: 'TEXT', originalName: 'quote' },
      ]
      const rows = [['She said "hello"']]

      const csv = serializeToCSV(columns, rows)

      expect(csv).toBe('quote\r\n"She said ""hello"""')
    })
  })
})
