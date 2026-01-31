/**
 * DDL Parser for CREATE TABLE statements.
 *
 * Parses sqlite_master.sql CREATE TABLE statements into an AST
 * that preserves all table-level clauses needed by rebuild.
 */

/**
 * Column definition in the AST.
 */
export interface ColumnNode {
  name: string
  type: string
  primaryKey?: boolean
  autoincrement?: boolean
  notNull?: boolean
  unique?: boolean
  defaultValue?: string
  check?: string
  collate?: string
  generatedAs?: string
  generatedType?: 'STORED' | 'VIRTUAL'
  onConflict?: 'ROLLBACK' | 'ABORT' | 'FAIL' | 'IGNORE' | 'REPLACE'
  references?: {
    table: string
    columns: string[]
    onDelete?: string
    onUpdate?: string
  }
}

/**
 * Table-level constraint in the AST.
 */
export interface TableConstraintNode {
  type: 'PRIMARY_KEY' | 'UNIQUE' | 'CHECK' | 'FOREIGN_KEY'
  name?: string
  columns?: string[]
  expression?: string
  references?: {
    table: string
    columns: string[]
  }
  onDelete?: string
  onUpdate?: string
}

/**
 * CREATE TABLE AST node.
 */
export interface CreateTableNode {
  tableName: string
  columns: ColumnNode[]
  tableConstraints: TableConstraintNode[]
  primaryKeyColumns?: string[]
  withoutRowid?: boolean
  strict?: boolean
}

/**
 * Parse a CREATE TABLE statement into an AST.
 */
export function parseCreateTable(sql: string): CreateTableNode {
  const parser = new CreateTableParser(sql)
  return parser.parse()
}

/**
 * Serialize a CREATE TABLE AST back to SQL.
 */
export function serializeCreateTable(ast: CreateTableNode): string {
  return new CreateTableSerializer(ast).serialize()
}

// --- Parser Implementation ---

class CreateTableParser {
  private sql: string
  private pos: number = 0

  constructor(sql: string) {
    this.sql = sql
  }

  parse(): CreateTableNode {
    this.skipWhitespace()
    this.expectKeyword('CREATE')
    this.skipWhitespace()
    this.expectKeyword('TABLE')
    this.skipWhitespace()

    // Optional IF NOT EXISTS
    if (this.matchKeyword('IF')) {
      this.skipWhitespace()
      this.expectKeyword('NOT')
      this.skipWhitespace()
      this.expectKeyword('EXISTS')
      this.skipWhitespace()
    }

    const tableName = this.parseIdentifier()
    this.skipWhitespace()
    this.expect('(')
    this.skipWhitespace()

    const columns: ColumnNode[] = []
    const tableConstraints: TableConstraintNode[] = []
    let primaryKeyColumns: string[] | undefined

    while (this.pos < this.sql.length && this.peek() !== ')') {
      this.skipWhitespace()

      // Check if this is a table constraint
      if (this.isTableConstraint()) {
        const constraint = this.parseTableConstraint()
        if (constraint.type === 'PRIMARY_KEY' && constraint.columns) {
          primaryKeyColumns = constraint.columns
        } else {
          tableConstraints.push(constraint)
        }
      } else {
        columns.push(this.parseColumn())
      }

      this.skipWhitespace()
      if (this.peek() === ',') {
        this.pos++
        this.skipWhitespace()
      }
    }

    this.expect(')')
    this.skipWhitespace()

    // Parse table options (WITHOUT ROWID, STRICT)
    let withoutRowid = false
    let strict = false

    while (this.pos < this.sql.length) {
      this.skipWhitespace()
      if (this.matchKeyword('WITHOUT')) {
        this.skipWhitespace()
        this.expectKeyword('ROWID')
        withoutRowid = true
      } else if (this.matchKeyword('STRICT')) {
        strict = true
      } else if (this.peek() === ',') {
        this.pos++
      } else {
        break
      }
    }

    return {
      tableName,
      columns,
      tableConstraints,
      primaryKeyColumns,
      withoutRowid: withoutRowid || undefined,
      strict: strict || undefined,
    }
  }

  private isTableConstraint(): boolean {
    const saved = this.pos
    this.skipWhitespace()

    // Named constraint
    if (this.matchKeyword('CONSTRAINT')) {
      this.pos = saved
      return true
    }

    // Unnamed table-level constraints
    if (
      this.matchKeyword('PRIMARY') ||
      this.matchKeyword('FOREIGN') ||
      this.matchKeyword('UNIQUE') ||
      this.matchKeyword('CHECK')
    ) {
      this.pos = saved
      return true
    }

    this.pos = saved
    return false
  }

  private parseTableConstraint(): TableConstraintNode {
    let name: string | undefined

    if (this.matchKeyword('CONSTRAINT')) {
      this.skipWhitespace()
      name = this.parseIdentifier()
      this.skipWhitespace()
    }

    if (this.matchKeyword('PRIMARY')) {
      this.skipWhitespace()
      this.expectKeyword('KEY')
      this.skipWhitespace()
      const columns = this.parseColumnList()
      return { type: 'PRIMARY_KEY', name, columns }
    }

    if (this.matchKeyword('UNIQUE')) {
      this.skipWhitespace()
      const columns = this.parseColumnList()
      return { type: 'UNIQUE', name, columns }
    }

    if (this.matchKeyword('CHECK')) {
      this.skipWhitespace()
      const expression = this.parseParenthesizedExpression()
      return { type: 'CHECK', name, expression }
    }

    if (this.matchKeyword('FOREIGN')) {
      this.skipWhitespace()
      this.expectKeyword('KEY')
      this.skipWhitespace()
      const columns = this.parseColumnList()
      this.skipWhitespace()
      this.expectKeyword('REFERENCES')
      this.skipWhitespace()
      const refTable = this.parseIdentifier()
      this.skipWhitespace()
      const refColumns = this.parseColumnList()
      this.skipWhitespace()

      const constraint: TableConstraintNode = {
        type: 'FOREIGN_KEY',
        name,
        columns,
        references: { table: refTable, columns: refColumns },
      }

      // Parse ON DELETE / ON UPDATE
      while (this.matchKeyword('ON')) {
        this.skipWhitespace()
        if (this.matchKeyword('DELETE')) {
          this.skipWhitespace()
          constraint.onDelete = this.parseForeignKeyAction()
        } else if (this.matchKeyword('UPDATE')) {
          this.skipWhitespace()
          constraint.onUpdate = this.parseForeignKeyAction()
        }
        this.skipWhitespace()
      }

      return constraint
    }

    throw new Error(`Unknown table constraint at position ${this.pos}`)
  }

  private parseColumn(): ColumnNode {
    const name = this.parseIdentifier()
    this.skipWhitespace()

    // Type is optional in SQLite
    let type = ''
    if (!this.isColumnConstraintStart() && this.peek() !== ',' && this.peek() !== ')') {
      type = this.parseType()
      this.skipWhitespace()
    }

    const col: ColumnNode = { name, type }

    // Parse column constraints
    while (this.isColumnConstraintStart()) {
      this.parseColumnConstraint(col)
      this.skipWhitespace()
    }

    return col
  }

  private isColumnConstraintStart(): boolean {
    const saved = this.pos
    this.skipWhitespace()

    const keywords = [
      'CONSTRAINT', 'PRIMARY', 'NOT', 'NULL', 'UNIQUE', 'CHECK',
      'DEFAULT', 'COLLATE', 'REFERENCES', 'GENERATED', 'AS', 'ON',
      'AUTOINCREMENT'
    ]

    for (const kw of keywords) {
      if (this.matchKeyword(kw)) {
        this.pos = saved
        return true
      }
    }

    this.pos = saved
    return false
  }

  private parseColumnConstraint(col: ColumnNode): void {
    this.skipWhitespace()

    // Named constraint (skip the name, we don't store it for column constraints)
    if (this.matchKeyword('CONSTRAINT')) {
      this.skipWhitespace()
      this.parseIdentifier()
      this.skipWhitespace()
    }

    if (this.matchKeyword('PRIMARY')) {
      this.skipWhitespace()
      this.expectKeyword('KEY')
      col.primaryKey = true
      this.skipWhitespace()

      // Check for ON CONFLICT
      if (this.matchKeyword('ON')) {
        this.skipWhitespace()
        this.expectKeyword('CONFLICT')
        this.skipWhitespace()
        col.onConflict = this.parseConflictAction()
        this.skipWhitespace()
      }

      // AUTOINCREMENT must come after PRIMARY KEY
      if (this.matchKeyword('AUTOINCREMENT')) {
        col.autoincrement = true
      }
      return
    }

    if (this.matchKeyword('AUTOINCREMENT')) {
      col.autoincrement = true
      return
    }

    if (this.matchKeyword('NOT')) {
      this.skipWhitespace()
      this.expectKeyword('NULL')
      col.notNull = true
      return
    }

    if (this.matchKeyword('NULL')) {
      // Explicit NULL constraint, ignore
      return
    }

    if (this.matchKeyword('UNIQUE')) {
      col.unique = true
      return
    }

    if (this.matchKeyword('CHECK')) {
      this.skipWhitespace()
      col.check = this.parseParenthesizedExpression()
      return
    }

    if (this.matchKeyword('DEFAULT')) {
      this.skipWhitespace()
      col.defaultValue = this.parseDefaultValue()
      return
    }

    if (this.matchKeyword('COLLATE')) {
      this.skipWhitespace()
      col.collate = this.parseIdentifier()
      return
    }

    if (this.matchKeyword('REFERENCES')) {
      this.skipWhitespace()
      const table = this.parseIdentifier()
      this.skipWhitespace()
      const columns = this.parseColumnList()
      col.references = { table, columns }
      return
    }

    if (this.matchKeyword('GENERATED')) {
      this.skipWhitespace()
      this.expectKeyword('ALWAYS')
      this.skipWhitespace()
      this.expectKeyword('AS')
      this.skipWhitespace()
      col.generatedAs = this.parseParenthesizedExpression()
      this.skipWhitespace()
      if (this.matchKeyword('STORED')) {
        col.generatedType = 'STORED'
      } else if (this.matchKeyword('VIRTUAL')) {
        col.generatedType = 'VIRTUAL'
      } else {
        col.generatedType = 'VIRTUAL' // default
      }
      return
    }

    // Short form: AS (expr) STORED/VIRTUAL
    if (this.matchKeyword('AS')) {
      this.skipWhitespace()
      col.generatedAs = this.parseParenthesizedExpression()
      this.skipWhitespace()
      if (this.matchKeyword('STORED')) {
        col.generatedType = 'STORED'
      } else if (this.matchKeyword('VIRTUAL')) {
        col.generatedType = 'VIRTUAL'
      } else {
        col.generatedType = 'VIRTUAL'
      }
      return
    }

    if (this.matchKeyword('ON')) {
      this.skipWhitespace()
      this.expectKeyword('CONFLICT')
      this.skipWhitespace()
      col.onConflict = this.parseConflictAction()
      return
    }
  }

  private parseConflictAction(): 'ROLLBACK' | 'ABORT' | 'FAIL' | 'IGNORE' | 'REPLACE' {
    if (this.matchKeyword('ROLLBACK')) return 'ROLLBACK'
    if (this.matchKeyword('ABORT')) return 'ABORT'
    if (this.matchKeyword('FAIL')) return 'FAIL'
    if (this.matchKeyword('IGNORE')) return 'IGNORE'
    if (this.matchKeyword('REPLACE')) return 'REPLACE'
    throw new Error(`Expected conflict action at position ${this.pos}`)
  }

  private parseForeignKeyAction(): string {
    if (this.matchKeyword('SET')) {
      this.skipWhitespace()
      if (this.matchKeyword('NULL')) return 'SET NULL'
      if (this.matchKeyword('DEFAULT')) return 'SET DEFAULT'
    }
    if (this.matchKeyword('CASCADE')) return 'CASCADE'
    if (this.matchKeyword('RESTRICT')) return 'RESTRICT'
    if (this.matchKeyword('NO')) {
      this.skipWhitespace()
      this.expectKeyword('ACTION')
      return 'NO ACTION'
    }
    throw new Error(`Expected FK action at position ${this.pos}`)
  }

  private parseType(): string {
    const start = this.pos
    // Type can include parentheses like VARCHAR(255) or DECIMAL(10,2)
    while (
      this.pos < this.sql.length &&
      this.peek() !== ',' &&
      this.peek() !== ')' &&
      !this.isColumnConstraintStart()
    ) {
      if (this.peek() === '(') {
        // Include the parenthesized part in the type
        this.pos++
        let depth = 1
        while (this.pos < this.sql.length && depth > 0) {
          if (this.peek() === '(') depth++
          else if (this.peek() === ')') depth--
          this.pos++
        }
      } else {
        this.pos++
      }
    }
    return this.sql.slice(start, this.pos).trim()
  }

  private parseDefaultValue(): string {
    this.skipWhitespace()
    if (this.peek() === '(') {
      // Parenthesized expression - keep the parens
      return '(' + this.parseParenthesizedExpression() + ')'
    }

    if (this.peek() === "'" || this.peek() === '"') {
      return this.parseString()
    }

    if (this.peek() === '+' || this.peek() === '-' || /\d/.test(this.peek())) {
      return this.parseNumber()
    }

    // Could be NULL, CURRENT_TIMESTAMP, etc.
    const start = this.pos
    while (
      this.pos < this.sql.length &&
      /[a-zA-Z0-9_]/.test(this.peek())
    ) {
      this.pos++
    }
    return this.sql.slice(start, this.pos)
  }

  private parseNumber(): string {
    const start = this.pos
    if (this.peek() === '+' || this.peek() === '-') {
      this.pos++
    }
    while (this.pos < this.sql.length && /[0-9.eE+-]/.test(this.peek())) {
      this.pos++
    }
    return this.sql.slice(start, this.pos)
  }

  private parseString(): string {
    const quote = this.peek()
    const start = this.pos
    this.pos++ // opening quote

    while (this.pos < this.sql.length) {
      if (this.peek() === quote) {
        this.pos++
        if (this.peek() === quote) {
          // escaped quote
          this.pos++
        } else {
          break
        }
      } else {
        this.pos++
      }
    }

    return this.sql.slice(start, this.pos)
  }

  private parseParenthesizedExpression(): string {
    this.expect('(')
    let depth = 1
    const start = this.pos

    while (this.pos < this.sql.length && depth > 0) {
      const ch = this.peek()
      if (ch === '(') {
        depth++
      } else if (ch === ')') {
        depth--
        if (depth === 0) break
      } else if (ch === "'" || ch === '"') {
        this.parseString()
        continue
      }
      this.pos++
    }

    const content = this.sql.slice(start, this.pos)
    this.expect(')')
    return content
  }

  private parseColumnList(): string[] {
    this.expect('(')
    this.skipWhitespace()

    const columns: string[] = []
    while (this.peek() !== ')') {
      columns.push(this.parseIdentifier())
      this.skipWhitespace()
      if (this.peek() === ',') {
        this.pos++
        this.skipWhitespace()
      }
    }

    this.expect(')')
    return columns
  }

  private parseIdentifier(): string {
    this.skipWhitespace()
    const ch = this.peek()

    if (ch === '"') {
      // Double-quoted identifier
      return this.parseQuotedIdentifier('"')
    }
    if (ch === '[') {
      // Bracket-quoted identifier (SQL Server style, SQLite accepts it)
      this.pos++
      const start = this.pos
      while (this.pos < this.sql.length && this.peek() !== ']') {
        this.pos++
      }
      const name = this.sql.slice(start, this.pos)
      this.expect(']')
      return name
    }
    if (ch === '`') {
      // Backtick-quoted identifier (MySQL style, SQLite accepts it)
      return this.parseQuotedIdentifier('`')
    }

    // Unquoted identifier
    const start = this.pos
    while (this.pos < this.sql.length && /[a-zA-Z0-9_$]/.test(this.peek())) {
      this.pos++
    }

    if (this.pos === start) {
      throw new Error(`Expected identifier at position ${this.pos}: "${this.sql.slice(this.pos, this.pos + 20)}"`)
    }

    return this.sql.slice(start, this.pos)
  }

  private parseQuotedIdentifier(quote: string): string {
    this.expect(quote)
    let result = ''

    while (this.pos < this.sql.length) {
      if (this.peek() === quote) {
        this.pos++
        if (this.peek() === quote) {
          // Escaped quote
          result += quote
          this.pos++
        } else {
          break
        }
      } else {
        result += this.peek()
        this.pos++
      }
    }

    return result
  }

  private peek(): string {
    return this.sql[this.pos] || ''
  }

  private expect(ch: string): void {
    if (this.peek() !== ch) {
      throw new Error(`Expected '${ch}' at position ${this.pos}, got '${this.peek()}'`)
    }
    this.pos++
  }

  private expectKeyword(keyword: string): void {
    if (!this.matchKeyword(keyword)) {
      throw new Error(`Expected '${keyword}' at position ${this.pos}`)
    }
  }

  private matchKeyword(keyword: string): boolean {
    const saved = this.pos
    this.skipWhitespace()

    for (let i = 0; i < keyword.length; i++) {
      if (
        this.pos + i >= this.sql.length ||
        this.sql[this.pos + i].toUpperCase() !== keyword[i].toUpperCase()
      ) {
        this.pos = saved
        return false
      }
    }

    // Make sure keyword ends (not part of a longer word)
    const nextChar = this.sql[this.pos + keyword.length]
    if (nextChar && /[a-zA-Z0-9_]/.test(nextChar)) {
      this.pos = saved
      return false
    }

    this.pos += keyword.length
    return true
  }

  private skipWhitespace(): void {
    while (this.pos < this.sql.length) {
      const ch = this.peek()
      if (/\s/.test(ch)) {
        this.pos++
      } else if (ch === '-' && this.sql[this.pos + 1] === '-') {
        // Line comment
        while (this.pos < this.sql.length && this.peek() !== '\n') {
          this.pos++
        }
      } else if (ch === '/' && this.sql[this.pos + 1] === '*') {
        // Block comment
        this.pos += 2
        while (this.pos < this.sql.length - 1) {
          if (this.peek() === '*' && this.sql[this.pos + 1] === '/') {
            this.pos += 2
            break
          }
          this.pos++
        }
      } else {
        break
      }
    }
  }
}

// --- Serializer Implementation ---

class CreateTableSerializer {
  private ast: CreateTableNode

  constructor(ast: CreateTableNode) {
    this.ast = ast
  }

  serialize(): string {
    const parts: string[] = ['CREATE TABLE', this.quoteIdentifier(this.ast.tableName)]
    const columnDefs: string[] = []

    // Serialize columns
    for (const col of this.ast.columns) {
      columnDefs.push(this.serializeColumn(col))
    }

    // Serialize table-level PRIMARY KEY
    if (this.ast.primaryKeyColumns && this.ast.primaryKeyColumns.length > 0) {
      columnDefs.push(`PRIMARY KEY (${this.ast.primaryKeyColumns.map(c => this.quoteIdentifier(c)).join(', ')})`)
    }

    // Serialize other table constraints
    for (const constraint of this.ast.tableConstraints) {
      columnDefs.push(this.serializeConstraint(constraint))
    }

    parts.push(`(\n  ${columnDefs.join(',\n  ')}\n)`)

    // Table options
    const options: string[] = []
    if (this.ast.withoutRowid) {
      options.push('WITHOUT ROWID')
    }
    if (this.ast.strict) {
      options.push('STRICT')
    }
    if (options.length > 0) {
      parts.push(options.join(', '))
    }

    return parts.join(' ')
  }

  private serializeColumn(col: ColumnNode): string {
    const parts: string[] = [this.quoteIdentifier(col.name)]

    if (col.type) {
      parts.push(col.type)
    }

    if (col.generatedAs) {
      parts.push(`GENERATED ALWAYS AS (${col.generatedAs}) ${col.generatedType || 'VIRTUAL'}`)
    } else {
      if (col.primaryKey) {
        parts.push('PRIMARY KEY')
        if (col.onConflict) {
          parts.push(`ON CONFLICT ${col.onConflict}`)
        }
        if (col.autoincrement) {
          parts.push('AUTOINCREMENT')
        }
      }

      if (col.notNull) {
        parts.push('NOT NULL')
      }

      if (col.unique) {
        parts.push('UNIQUE')
      }

      if (col.defaultValue !== undefined) {
        parts.push(`DEFAULT ${col.defaultValue}`)
      }

      if (col.collate) {
        parts.push(`COLLATE ${col.collate}`)
      }

      if (col.check) {
        parts.push(`CHECK (${col.check})`)
      }

      if (col.references) {
        parts.push(`REFERENCES ${this.quoteIdentifier(col.references.table)}(${col.references.columns.map(c => this.quoteIdentifier(c)).join(', ')})`)
        if (col.references.onDelete) {
          parts.push(`ON DELETE ${col.references.onDelete}`)
        }
        if (col.references.onUpdate) {
          parts.push(`ON UPDATE ${col.references.onUpdate}`)
        }
      }
    }

    return parts.join(' ')
  }

  private serializeConstraint(constraint: TableConstraintNode): string {
    const parts: string[] = []

    if (constraint.name) {
      parts.push(`CONSTRAINT ${this.quoteIdentifier(constraint.name)}`)
    }

    switch (constraint.type) {
      case 'PRIMARY_KEY':
        parts.push(`PRIMARY KEY (${constraint.columns!.map(c => this.quoteIdentifier(c)).join(', ')})`)
        break
      case 'UNIQUE':
        parts.push(`UNIQUE (${constraint.columns!.map(c => this.quoteIdentifier(c)).join(', ')})`)
        break
      case 'CHECK':
        parts.push(`CHECK (${constraint.expression})`)
        break
      case 'FOREIGN_KEY':
        parts.push(`FOREIGN KEY (${constraint.columns!.map(c => this.quoteIdentifier(c)).join(', ')})`)
        parts.push(`REFERENCES ${this.quoteIdentifier(constraint.references!.table)}(${constraint.references!.columns.map(c => this.quoteIdentifier(c)).join(', ')})`)
        if (constraint.onDelete) {
          parts.push(`ON DELETE ${constraint.onDelete}`)
        }
        if (constraint.onUpdate) {
          parts.push(`ON UPDATE ${constraint.onUpdate}`)
        }
        break
    }

    return parts.join(' ')
  }

  private quoteIdentifier(name: string): string {
    // Check if quoting is needed
    if (this.needsQuoting(name)) {
      return `"${name.replace(/"/g, '""')}"`
    }
    return name
  }

  private needsQuoting(identifier: string): boolean {
    if (!identifier || identifier.length === 0) {
      return true
    }

    // Starts with a digit
    if (/^\d/.test(identifier)) {
      return true
    }

    // Contains anything other than alphanumeric and underscore
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
      return true
    }

    // Reserved keywords (simplified set for common ones)
    const reserved = new Set([
      'ABORT', 'ACTION', 'ADD', 'AFTER', 'ALL', 'ALTER', 'ALWAYS', 'ANALYZE', 'AND',
      'AS', 'ASC', 'ATTACH', 'AUTOINCREMENT', 'BEFORE', 'BEGIN', 'BETWEEN', 'BY',
      'CASCADE', 'CASE', 'CAST', 'CHECK', 'COLLATE', 'COLUMN', 'COMMIT', 'CONFLICT',
      'CONSTRAINT', 'CREATE', 'CROSS', 'CURRENT', 'CURRENT_DATE', 'CURRENT_TIME',
      'CURRENT_TIMESTAMP', 'DATABASE', 'DEFAULT', 'DEFERRABLE', 'DEFERRED', 'DELETE',
      'DESC', 'DETACH', 'DISTINCT', 'DO', 'DROP', 'EACH', 'ELSE', 'END', 'ESCAPE',
      'EXCEPT', 'EXCLUDE', 'EXCLUSIVE', 'EXISTS', 'EXPLAIN', 'FAIL', 'FILTER',
      'FIRST', 'FOLLOWING', 'FOR', 'FOREIGN', 'FROM', 'FULL', 'GENERATED', 'GLOB',
      'GROUP', 'GROUPS', 'HAVING', 'IF', 'IGNORE', 'IMMEDIATE', 'IN', 'INDEX',
      'INDEXED', 'INITIALLY', 'INNER', 'INSERT', 'INSTEAD', 'INTERSECT', 'INTO',
      'IS', 'ISNULL', 'JOIN', 'KEY', 'LAST', 'LEFT', 'LIKE', 'LIMIT', 'MATCH',
      'MATERIALIZED', 'NATURAL', 'NO', 'NOT', 'NOTHING', 'NOTNULL', 'NULL', 'NULLS',
      'OF', 'OFFSET', 'ON', 'OR', 'ORDER', 'OTHERS', 'OUTER', 'OVER', 'PARTITION',
      'PLAN', 'PRAGMA', 'PRECEDING', 'PRIMARY', 'QUERY', 'RAISE', 'RANGE',
      'RECURSIVE', 'REFERENCES', 'REGEXP', 'REINDEX', 'RELEASE', 'RENAME', 'REPLACE',
      'RESTRICT', 'RETURNING', 'RIGHT', 'ROLLBACK', 'ROW', 'ROWS', 'SAVEPOINT',
      'SELECT', 'SET', 'TABLE', 'TEMP', 'TEMPORARY', 'THEN', 'TIES', 'TO',
      'TRANSACTION', 'TRIGGER', 'UNBOUNDED', 'UNION', 'UNIQUE', 'UPDATE', 'USING',
      'VACUUM', 'VALUES', 'VIEW', 'VIRTUAL', 'WHEN', 'WHERE', 'WINDOW', 'WITH',
      'WITHOUT',
    ])

    return reserved.has(identifier.toUpperCase())
  }
}
