/**
 * Unit tests for error position mapping
 *
 * Tests byte offset to line:column conversion with:
 * - Basic ASCII text
 * - Multi-line SQL
 * - Multi-byte UTF-8 characters
 * - Multi-statement queries
 */

import { describe, it, expect } from 'vitest';
import {
  byteOffsetToPosition,
  computeErrorPosition,
  splitStatementsWithSpans,
  extractNearToken,
  findTokenByteOffset,
  mapSqlErrorPosition,
  type Position,
  type StatementSpan,
} from '../errorPosition';

describe('byteOffsetToPosition', () => {
  describe('basic ASCII text', () => {
    it('returns line 1, column 1 for offset 0', () => {
      const text = 'SELECT * FROM users';
      const pos = byteOffsetToPosition(text, 0);
      expect(pos).toEqual({ line: 1, column: 1 });
    });

    it('returns correct column for offset within first line', () => {
      const text = 'SELECT * FROM users';
      // Offset 7 is the space before *
      const pos = byteOffsetToPosition(text, 7);
      expect(pos).toEqual({ line: 1, column: 8 });
    });

    it('returns line 2, column 1 for offset at start of second line', () => {
      const text = 'SELECT\nFROM';
      // After 'SELECT\n', next char is at offset 7
      const pos = byteOffsetToPosition(text, 7);
      expect(pos).toEqual({ line: 2, column: 1 });
    });

    it('handles multiple newlines', () => {
      const text = 'line1\nline2\nline3';
      // 'line3' starts at offset 12
      const pos = byteOffsetToPosition(text, 12);
      expect(pos).toEqual({ line: 3, column: 1 });
    });

    it('handles CRLF line endings', () => {
      const text = 'line1\r\nline2';
      // After 'line1\r\n', next char is at offset 7
      const pos = byteOffsetToPosition(text, 7);
      expect(pos).toEqual({ line: 2, column: 1 });
    });

    it('handles CR only line endings', () => {
      const text = 'line1\rline2';
      // After 'line1\r', next char is at offset 6
      const pos = byteOffsetToPosition(text, 6);
      expect(pos).toEqual({ line: 2, column: 1 });
    });
  });

  describe('multi-byte UTF-8 characters', () => {
    it('counts columns correctly for 2-byte UTF-8 (é)', () => {
      // 'é' is 2 bytes in UTF-8 (C3 A9)
      const text = 'café';
      // 'c' at offset 0, 'a' at 1, 'f' at 2, 'é' at 3-4
      // After 'café', byte offset 5 is past the string
      // Column should count characters, not bytes
      const pos = byteOffsetToPosition(text, 3);
      expect(pos).toEqual({ line: 1, column: 4 }); // 4th character
    });

    it('counts columns correctly for 3-byte UTF-8 (€)', () => {
      // '€' is 3 bytes in UTF-8 (E2 82 AC)
      const text = '€100';
      // '€' is at offset 0-2, '1' at 3, '0' at 4, '0' at 5
      const pos = byteOffsetToPosition(text, 3);
      expect(pos).toEqual({ line: 1, column: 2 }); // '1' is 2nd char
    });

    it('counts columns correctly for 4-byte UTF-8 (emoji)', () => {
      // '😀' is 4 bytes in UTF-8
      const text = '😀ok';
      // '😀' is at offset 0-3, 'o' at 4, 'k' at 5
      const pos = byteOffsetToPosition(text, 4);
      expect(pos).toEqual({ line: 1, column: 2 }); // 'o' is 2nd char
    });

    it('handles mixed ASCII and UTF-8 with newlines', () => {
      const text = 'SELECT\n名前 FROM users';
      // '名' is 3 bytes (E5 90 8D), '前' is 3 bytes
      // Line 2 starts at offset 7
      // At offset 13 (7 + 3 + 3), we're at the space before 'FROM'
      const pos = byteOffsetToPosition(text, 13);
      expect(pos).toEqual({ line: 2, column: 3 }); // space is 3rd char on line 2
    });

    it('handles UTF-8 on multiple lines', () => {
      const text = 'Привет\nМир';
      // 'Привет' = 6 chars, each 2 bytes = 12 bytes, plus '\n' = 13
      // 'М' starts at byte offset 13
      const pos = byteOffsetToPosition(text, 13);
      expect(pos).toEqual({ line: 2, column: 1 });
    });
  });

  describe('edge cases', () => {
    it('returns line 1 column 1 for empty string', () => {
      const pos = byteOffsetToPosition('', 0);
      expect(pos).toEqual({ line: 1, column: 1 });
    });

    it('clamps offset beyond string length', () => {
      const text = 'abc';
      const pos = byteOffsetToPosition(text, 100);
      // Should return position at end of string
      expect(pos).toEqual({ line: 1, column: 4 }); // past last char
    });

    it('handles negative offset', () => {
      const text = 'abc';
      const pos = byteOffsetToPosition(text, -1);
      expect(pos).toEqual({ line: 1, column: 1 });
    });

    it('handles offset in middle of multi-byte character', () => {
      // If offset lands in the middle of a UTF-8 sequence,
      // return position of that character
      const text = '😀ok';
      // Emoji is bytes 0-3, if we ask for offset 2, we should get column 1
      const pos = byteOffsetToPosition(text, 2);
      expect(pos).toEqual({ line: 1, column: 1 }); // still on the emoji
    });
  });
});

describe('computeErrorPosition', () => {
  describe('computeErrorPosition: single statement', () => {
    it('maps error at start of statement', () => {
      const sql = 'SELEC * FROM users';
      const span: StatementSpan = { start: 0, end: 18, sql: 'SELEC * FROM users' };
      const pos = computeErrorPosition(sql, span, 0);
      expect(pos).toEqual({ line: 1, column: 1 });
    });

    it('maps error in middle of statement', () => {
      const sql = 'SELECT * FORM users';
      const span: StatementSpan = { start: 0, end: 19, sql: 'SELECT * FORM users' };
      // 'FORM' starts at offset 9
      const pos = computeErrorPosition(sql, span, 9);
      expect(pos).toEqual({ line: 1, column: 10 });
    });
  });

  describe('computeErrorPosition: multi-statement', () => {
    it('maps error in second statement to correct line', () => {
      const sql = 'SELECT 1;\nSELECT FORM users';
      // Second statement starts at offset 10
      const span: StatementSpan = { start: 10, end: 27, sql: 'SELECT FORM users' };
      // Error at 'FORM' which is offset 7 within the statement
      const pos = computeErrorPosition(sql, span, 7);
      expect(pos).toEqual({ line: 2, column: 8 }); // SELECT[space]F = column 8
    });

    it('computeErrorPosition maps error in third statement across multiple lines', () => {
      const sql = `CREATE TABLE t (id INT);
INSERT INTO t VALUES (1);
SELEC * FROM t`;
      // Third statement starts at line 3
      const thirdStart = sql.indexOf('SELEC');
      const span: StatementSpan = { start: thirdStart, end: sql.length, sql: 'SELEC * FROM t' };
      const pos = computeErrorPosition(sql, span, 0);
      expect(pos).toEqual({ line: 3, column: 1 });
    });

    it('handles statement with leading whitespace', () => {
      const sql = 'SELECT 1;\n  SELEC * FROM users';
      // Second statement with whitespace trimmed starts at offset 12
      const span: StatementSpan = { start: 10, end: 31, sql: '  SELEC * FROM users' };
      // 'SELEC' starts at offset 2 within the span (after leading spaces)
      const pos = computeErrorPosition(sql, span, 2);
      expect(pos).toEqual({ line: 2, column: 3 }); // column 3 because of 2 leading spaces
    });
  });

  describe('multi-line statements', () => {
    it('maps error in multi-line CREATE TABLE', () => {
      const sql = `CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  naem TEXT NOT NULL
)`;
      const span: StatementSpan = { start: 0, end: sql.length, sql };
      // 'naem' is on line 3, find its offset
      const naemOffset = sql.indexOf('naem');
      const pos = computeErrorPosition(sql, span, naemOffset);
      expect(pos).toEqual({ line: 3, column: 3 }); // 2 spaces + 'n'
    });

    it('maps error at end of multi-line statement', () => {
      const sql = `SELECT *
FROM users
WHERE id =`;
      const span: StatementSpan = { start: 0, end: sql.length, sql };
      // Error at the end (missing value after =)
      const pos = computeErrorPosition(sql, span, sql.length);
      expect(pos).toEqual({ line: 3, column: 11 }); // past 'WHERE id ='
    });
  });

  describe('UTF-8 in SQL', () => {
    it('maps error after UTF-8 table name', () => {
      const sql = 'SELECT * FROM 用户 WHER id = 1';
      const span: StatementSpan = { start: 0, end: sql.length, sql };
      // '用户' is 2 chars, 6 bytes. 'WHER' starts after that
      // 'SELECT * FROM ' = 14 bytes, '用户' = 6 bytes, ' ' = 1 byte = 21 bytes
      const wherByteOffset = 21;
      const pos = computeErrorPosition(sql, span, wherByteOffset);
      // 'SELECT * FROM 用户 ' = 17 chars (including space), 'W' is 18th
      expect(pos).toEqual({ line: 1, column: 18 });
    });

    it('maps error with UTF-8 on multiple lines', () => {
      const sql = `SELECT *
FROM таблица
WHER id = 1`;
      const span: StatementSpan = { start: 0, end: sql.length, sql };
      // 'SELECT *\n' = 9 bytes, 'FROM таблица\n' = 'FROM ' (5) + 'таблица' (14) + '\n' (1) = 20 bytes
      // Total before WHER = 29 bytes
      const wherByteOffset = 29;
      const pos = computeErrorPosition(sql, span, wherByteOffset);
      expect(pos).toEqual({ line: 3, column: 1 });
    });
  });
});

describe('Position type', () => {
  it('has correct structure', () => {
    const pos: Position = { line: 1, column: 1 };
    expect(pos.line).toBe(1);
    expect(pos.column).toBe(1);
  });
});

describe('splitStatementsWithSpans', () => {
  it('returns spans with correct byte offsets for simple statements', () => {
    const sql = 'SELECT 1; SELECT 2';
    const spans = splitStatementsWithSpans(sql);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toEqual({ start: 0, end: 8, sql: 'SELECT 1' });
    expect(spans[1]).toEqual({ start: 10, end: 18, sql: 'SELECT 2' });
  });

  it('handles whitespace between statements', () => {
    const sql = 'SELECT 1;\n  SELECT 2';
    const spans = splitStatementsWithSpans(sql);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toEqual({ start: 0, end: 8, sql: 'SELECT 1' });
    // Second statement starts after '; \n  '
    expect(spans[1]).toEqual({ start: 12, end: 20, sql: 'SELECT 2' });
  });

  it('handles UTF-8 in statements', () => {
    const sql = 'SELECT 名前; SELECT 2';
    const spans = splitStatementsWithSpans(sql);
    expect(spans).toHaveLength(2);
    // '名前' is 2 chars, 6 bytes each = 6 bytes total
    // 'SELECT 名前' = 7 + 6 = 13 bytes
    expect(spans[0].sql).toBe('SELECT 名前');
    expect(spans[0].start).toBe(0);
    expect(spans[0].end).toBe(13);
  });

  it('tracks offsets across multiple lines', () => {
    const sql = `SELECT 1;
SELECT 2;
SELECT 3`;
    const spans = splitStatementsWithSpans(sql);
    expect(spans).toHaveLength(3);
    expect(spans[0].sql).toBe('SELECT 1');
    expect(spans[1].sql).toBe('SELECT 2');
    expect(spans[2].sql).toBe('SELECT 3');
    // First statement: 'SELECT 1' at 0-7
    expect(spans[0].start).toBe(0);
    // Second statement: after ';\\nSELECT 2' starts at 10
    expect(spans[1].start).toBe(10);
    // Third statement: after ';\\nSELECT 3' starts at 20
    expect(spans[2].start).toBe(20);
  });

  it('handles statements in string literals correctly', () => {
    const sql = "SELECT ';'; SELECT 2";
    const spans = splitStatementsWithSpans(sql);
    expect(spans).toHaveLength(2);
    expect(spans[0].sql).toBe("SELECT ';'");
    expect(spans[1].sql).toBe('SELECT 2');
  });
});

describe('extractNearToken', () => {
  it('extracts token from near error', () => {
    const msg = 'near "SELEC": syntax error';
    expect(extractNearToken(msg)).toBe('SELEC');
  });

  it('returns undefined for non-matching message', () => {
    const msg = 'constraint violation';
    expect(extractNearToken(msg)).toBeUndefined();
  });

  it('handles case insensitivity', () => {
    const msg = 'NEAR "token": syntax error';
    expect(extractNearToken(msg)).toBe('token');
  });
});

describe('findTokenByteOffset', () => {
  it('finds ASCII token offset', () => {
    const sql = 'SELECT * FORM users';
    expect(findTokenByteOffset(sql, 'FORM')).toBe(9);
  });

  it('finds token after UTF-8 content', () => {
    const sql = 'SELECT 名前 FORM users';
    // 'SELECT ' = 7 bytes, '名前' = 6 bytes, ' ' = 1 byte = 14 bytes
    expect(findTokenByteOffset(sql, 'FORM')).toBe(14);
  });

  it('returns 0 if token not found', () => {
    const sql = 'SELECT * FROM users';
    expect(findTokenByteOffset(sql, 'xyz')).toBe(0);
  });

  it('is case insensitive', () => {
    const sql = 'SELECT * from users';
    expect(findTokenByteOffset(sql, 'FROM')).toBe(9);
  });
});

describe('mapSqlErrorPosition', () => {
  describe('mapSqlErrorPosition: single statement', () => {
    it('maps error with near token', () => {
      const sql = 'SELECT * FORM users';
      const error = 'near "FORM": syntax error';
      const pos = mapSqlErrorPosition(sql, error);
      // 'FORM' starts at column 10 (after 'SELECT * ')
      expect(pos).toEqual({ line: 1, column: 10 });
    });

    it('returns start of statement if no near token', () => {
      const sql = 'SELECT * FROM';
      const error = 'incomplete input';
      const pos = mapSqlErrorPosition(sql, error);
      expect(pos).toEqual({ line: 1, column: 1 });
    });
  });

  describe('mapSqlErrorPosition: multi-statement', () => {
    it('maps error in second statement', () => {
      const sql = `SELECT 1;
SELECT * FORM users`;
      const error = 'near "FORM": syntax error';
      const pos = mapSqlErrorPosition(sql, error, 1);
      // Line 2, 'FORM' at column 10
      expect(pos).toEqual({ line: 2, column: 10 });
    });

    it('mapSqlErrorPosition maps error in third statement across multiple lines', () => {
      const sql = `CREATE TABLE t (id INT);
INSERT INTO t VALUES (1);
SELEC * FROM t`;
      const error = 'near "SELEC": syntax error';
      const pos = mapSqlErrorPosition(sql, error, 2);
      expect(pos).toEqual({ line: 3, column: 1 });
    });

    it('falls back to statement start if near token not in statement', () => {
      const sql = `SELECT 1;
SELECT * FORM users`;
      // Token "xyz" doesn't exist
      const error = 'near "xyz": syntax error';
      const pos = mapSqlErrorPosition(sql, error, 1);
      // Should return start of second statement
      expect(pos).toEqual({ line: 2, column: 1 });
    });
  });

  describe('error on line 5 highlights line 5', () => {
    it('correctly maps error on line 5 of multi-line statement', () => {
      const sql = `SELECT
  a,
  b,
  c,
  FORM
  users`;
      const error = 'near "FORM": syntax error';
      const pos = mapSqlErrorPosition(sql, error);
      // FORM is on line 5
      expect(pos.line).toBe(5);
    });
  });

  describe('UTF-8 handling', () => {
    it('correctly maps error after UTF-8 content', () => {
      const sql = 'SELECT * FROM 用户 WHER id = 1';
      const error = 'near "WHER": syntax error';
      const pos = mapSqlErrorPosition(sql, error);
      // 'SELECT * FROM 用户 ' = 17 chars, 'W' is 18th
      expect(pos).toEqual({ line: 1, column: 18 });
    });
  });
});
