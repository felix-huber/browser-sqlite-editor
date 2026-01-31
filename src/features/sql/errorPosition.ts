/**
 * Error Position Mapping
 *
 * Converts byte offsets from SQLite errors to line:column positions
 * for display in the editor. Handles:
 * - Multi-byte UTF-8 characters
 * - Multi-statement SQL scripts
 * - Various line ending styles (LF, CRLF, CR)
 */

/**
 * Line and column position (1-based)
 */
export interface Position {
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based, character offset not byte offset) */
  column: number;
}

/**
 * Span of a statement within the original SQL text
 */
export interface StatementSpan {
  /** Byte offset where statement starts in original text */
  start: number;
  /** Byte offset where statement ends in original text */
  end: number;
  /** The statement SQL text */
  sql: string;
}

/**
 * Convert a byte offset to line:column position.
 *
 * This function properly handles:
 * - Multi-byte UTF-8 characters (columns count characters, not bytes)
 * - All line ending styles: LF (\n), CRLF (\r\n), CR (\r)
 * - Edge cases like empty strings and out-of-bounds offsets
 *
 * @param text The full text to search within
 * @param byteOffset The byte offset to convert (0-based)
 * @returns Position with 1-based line and column
 */
export function byteOffsetToPosition(text: string, byteOffset: number): Position {
  // Handle edge cases
  if (!text || byteOffset <= 0) {
    return { line: 1, column: 1 };
  }

  // Encode text to get byte representation
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);

  // Clamp offset to valid range
  const clampedOffset = Math.min(byteOffset, bytes.length);

  // We need to find where in the original string the byte offset falls.
  // The tricky part is that a byte offset might land in the middle of a
  // multi-byte UTF-8 sequence. In that case, we want the position of that character.

  // Strategy: iterate through characters, track byte position and character position
  let line = 1;
  let column = 1;
  let currentByteOffset = 0;
  let i = 0;

  while (i < text.length && currentByteOffset < clampedOffset) {
    const char = text[i];
    const codePoint = text.codePointAt(i)!;

    // Calculate byte length of this character
    let charByteLength: number;
    if (codePoint <= 0x7f) {
      charByteLength = 1;
    } else if (codePoint <= 0x7ff) {
      charByteLength = 2;
    } else if (codePoint <= 0xffff) {
      charByteLength = 3;
    } else {
      charByteLength = 4;
    }

    // Check if the target byte offset is within this character
    if (currentByteOffset + charByteLength > clampedOffset) {
      // Target offset is in the middle of this character, return current position
      break;
    }

    currentByteOffset += charByteLength;

    // Handle line endings
    if (char === '\n') {
      // For LF or the LF part of CRLF
      // If previous char was \r (CRLF), we already incremented line, so skip
      if (i > 0 && text[i - 1] === '\r') {
        // CRLF: \r already handled the line break, skip the \n
      } else {
        line++;
        column = 1;
      }
    } else if (char === '\r') {
      // CR always starts a new line (whether CR-only or CRLF)
      line++;
      column = 1;
    } else {
      // Handle surrogate pairs (4-byte UTF-8 encoded as 2 UTF-16 code units)
      if (codePoint > 0xffff) {
        i++; // Skip the low surrogate
      }
      column++;
    }

    i++;
  }

  return { line, column };
}

/**
 * Compute the error position within the full SQL text given a statement span
 * and an error offset within that statement.
 *
 * @param fullSql The complete SQL text with all statements
 * @param statementSpan The span describing where the statement is in fullSql
 * @param errorOffsetInStatement Byte offset of error within the statement (0-based)
 * @returns Position in the full SQL text (1-based line and column)
 */
export function computeErrorPosition(
  fullSql: string,
  statementSpan: StatementSpan,
  errorOffsetInStatement: number,
): Position {
  // The absolute byte offset in the full SQL
  const absoluteByteOffset = statementSpan.start + errorOffsetInStatement;

  // Convert to line:column
  return byteOffsetToPosition(fullSql, absoluteByteOffset);
}

/**
 * Extract the "near" token from SQLite error messages.
 * SQLite errors often include: near "TOKEN": syntax error
 *
 * @param errorMessage The SQLite error message
 * @returns The token name or undefined if not found
 */
export function extractNearToken(errorMessage: string): string | undefined {
  const match = errorMessage.match(/near\s+"([^"]+)"/i);
  return match?.[1];
}

/**
 * Find the byte offset of a token within a SQL statement.
 * Used to pinpoint error location when SQLite says "near TOKEN".
 *
 * SQLite errors typically occur at the point where parsing fails, which
 * is usually at or near the END of the successfully parsed portion.
 * Therefore, we find the LAST occurrence of the token, as it's more
 * likely to be the error location than the first.
 *
 * @param sql The SQL statement
 * @param token The token to find
 * @returns Byte offset of the token or 0 if not found
 */
export function findTokenByteOffset(sql: string, token: string): number {
  // Case-insensitive search for the LAST occurrence of the token
  const lowerSql = sql.toLowerCase();
  const lowerToken = token.toLowerCase();
  const charIndex = lowerSql.lastIndexOf(lowerToken);

  if (charIndex === -1) {
    return 0;
  }

  // Convert character index to byte offset
  const encoder = new TextEncoder();
  const bytesBeforeToken = encoder.encode(sql.substring(0, charIndex));
  return bytesBeforeToken.length;
}

/**
 * Map an error to line:column position in the original SQL.
 *
 * This is the main entry point for error position mapping. It:
 * 1. Parses the SQL into statements with byte offsets
 * 2. Uses the statement index (if provided) to find the right span
 * 3. Extracts the "near" token from the error message
 * 4. Computes the final line:column position
 *
 * @param fullSql The complete SQL text
 * @param errorMessage The SQLite error message
 * @param statementIndex Optional 0-based statement index
 * @returns Position in the full SQL text (1-based line and column)
 */
export function mapSqlErrorPosition(
  fullSql: string,
  errorMessage: string,
  statementIndex?: number,
): Position {
  const spans = splitStatementsWithSpans(fullSql);

  if (spans.length === 0) {
    return { line: 1, column: 1 };
  }

  // Get the relevant statement span
  const idx = statementIndex !== undefined && statementIndex >= 0 && statementIndex < spans.length
    ? statementIndex
    : 0;
  const span = spans[idx];

  // Try to find the "near" token in the error message
  const nearToken = extractNearToken(errorMessage);
  if (nearToken) {
    // Find where this token appears in the statement
    const tokenOffset = findTokenByteOffset(span.sql, nearToken);
    if (tokenOffset > 0) {
      return computeErrorPosition(fullSql, span, tokenOffset);
    }
  }

  // No "near" token found, return start of statement
  return computeErrorPosition(fullSql, span, 0);
}

/**
 * State machine states for SQL parsing
 */
type ParserState =
  | 'normal'
  | 'single_quote'
  | 'double_quote'
  | 'backtick'
  | 'line_comment'
  | 'block_comment';

/**
 * Split SQL text into individual statements with byte offset tracking.
 *
 * This is an enhanced version of splitStatements that also tracks
 * where each statement begins and ends in terms of byte offsets.
 *
 * @param sql Multi-statement SQL text
 * @returns Array of statement spans with byte offsets
 */
export function splitStatementsWithSpans(sql: string): StatementSpan[] {
  const spans: StatementSpan[] = [];
  const encoder = new TextEncoder();

  let currentChars: string[] = [];
  let state: ParserState = 'normal';
  let i = 0;
  let byteOffset = 0;

  // Track where current statement content actually starts (after leading whitespace)
  let contentStartByteOffset = 0;
  let hasContent = false;

  while (i < sql.length) {
    const char = sql[i];
    const nextChar = sql[i + 1];
    const charBytes = encoder.encode(char).length;

    switch (state) {
      case 'normal':
        if (char === ';') {
          // End of statement
          const stmtText = currentChars.join('').trim();
          if (stmtText) {
            spans.push({
              start: contentStartByteOffset,
              end: byteOffset,
              sql: stmtText,
            });
          }
          currentChars = [];
          contentStartByteOffset = byteOffset + charBytes;
          hasContent = false;
        } else if (char === "'") {
          if (!hasContent) {
            contentStartByteOffset = byteOffset;
            hasContent = true;
          }
          currentChars.push(char);
          state = 'single_quote';
        } else if (char === '"') {
          if (!hasContent) {
            contentStartByteOffset = byteOffset;
            hasContent = true;
          }
          currentChars.push(char);
          state = 'double_quote';
        } else if (char === '`') {
          if (!hasContent) {
            contentStartByteOffset = byteOffset;
            hasContent = true;
          }
          currentChars.push(char);
          state = 'backtick';
        } else if (char === '-' && nextChar === '-') {
          state = 'line_comment';
          i++; // Skip the second dash
          byteOffset += charBytes;
        } else if (char === '/' && nextChar === '*') {
          state = 'block_comment';
          i++; // Skip the asterisk
          byteOffset += charBytes;
        } else if (/\s/.test(char)) {
          // Whitespace
          if (hasContent) {
            currentChars.push(char);
          } else {
            // Skip leading whitespace, update start offset
            contentStartByteOffset = byteOffset + charBytes;
          }
        } else {
          if (!hasContent) {
            contentStartByteOffset = byteOffset;
            hasContent = true;
          }
          currentChars.push(char);
        }
        break;

      case 'single_quote':
        currentChars.push(char);
        if (char === "'") {
          if (nextChar === "'") {
            currentChars.push(nextChar);
            i++;
            byteOffset += charBytes;
          } else {
            state = 'normal';
          }
        }
        break;

      case 'double_quote':
        currentChars.push(char);
        if (char === '"') {
          if (nextChar === '"') {
            currentChars.push(nextChar);
            i++;
            byteOffset += charBytes;
          } else {
            state = 'normal';
          }
        }
        break;

      case 'backtick':
        currentChars.push(char);
        if (char === '`') {
          if (nextChar === '`') {
            currentChars.push(nextChar);
            i++;
            byteOffset += charBytes;
          } else {
            state = 'normal';
          }
        }
        break;

      case 'line_comment':
        if (char === '\n' || char === '\r') {
          state = 'normal';
          if (hasContent) {
            currentChars.push(' ');
          }
        }
        break;

      case 'block_comment':
        if (char === '*' && nextChar === '/') {
          state = 'normal';
          i++;
          byteOffset += charBytes;
          if (hasContent) {
            currentChars.push(' ');
          }
        }
        break;
    }

    byteOffset += charBytes;
    i++;
  }

  // Handle last statement (may not end with semicolon)
  const stmtText = currentChars.join('').trim();
  if (stmtText) {
    spans.push({
      start: contentStartByteOffset,
      end: byteOffset,
      sql: stmtText,
    });
  }

  return spans;
}
