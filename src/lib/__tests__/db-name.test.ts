import { describe, it, expect } from 'vitest';
import { validateDbName, sanitizeDbName, isNameAvailable } from '../db-name';

describe('validateDbName', () => {
  it('should accept valid names', () => {
    expect(validateDbName('mydb')).toEqual({ valid: true });
    expect(validateDbName('My Database')).toEqual({ valid: true });
    expect(validateDbName('test-db_v2')).toEqual({ valid: true });
    expect(validateDbName('project (backup)')).toEqual({ valid: true });
    expect(validateDbName('DB123')).toEqual({ valid: true });
  });

  it('should reject empty names', () => {
    expect(validateDbName('')).toEqual({ valid: false, error: 'Name cannot be empty' });
    expect(validateDbName('   ')).toEqual({ valid: false, error: 'Name cannot be empty' });
    expect(validateDbName('\t\n')).toEqual({ valid: false, error: 'Name cannot be empty' });
  });

  it('should reject names with forward slash', () => {
    expect(validateDbName('path/to/db')).toEqual({ valid: false, error: 'Name cannot contain /' });
    expect(validateDbName('/root')).toEqual({ valid: false, error: 'Name cannot contain /' });
  });

  it('should reject names with backslash', () => {
    expect(validateDbName('path\\to\\db')).toEqual({ valid: false, error: 'Name cannot contain \\' });
  });

  it('should reject names starting with dot', () => {
    expect(validateDbName('.hidden')).toEqual({ valid: false, error: 'Name cannot start with .' });
    expect(validateDbName('.git')).toEqual({ valid: false, error: 'Name cannot start with .' });
  });

  it('should reject names with path traversal', () => {
    expect(validateDbName('foo..bar')).toEqual({ valid: false, error: 'Invalid name' });
    expect(validateDbName('..')).toEqual({ valid: false, error: 'Name cannot start with .' });
    expect(validateDbName('a..b')).toEqual({ valid: false, error: 'Invalid name' });
  });

  it('should reject Windows reserved names', () => {
    expect(validateDbName('CON')).toEqual({ valid: false, error: 'Reserved name' });
    expect(validateDbName('con')).toEqual({ valid: false, error: 'Reserved name' });
    expect(validateDbName('PRN')).toEqual({ valid: false, error: 'Reserved name' });
    expect(validateDbName('NUL')).toEqual({ valid: false, error: 'Reserved name' });
    expect(validateDbName('AUX')).toEqual({ valid: false, error: 'Reserved name' });
    expect(validateDbName('COM1')).toEqual({ valid: false, error: 'Reserved name' });
    expect(validateDbName('COM9')).toEqual({ valid: false, error: 'Reserved name' });
    expect(validateDbName('LPT1')).toEqual({ valid: false, error: 'Reserved name' });
    expect(validateDbName('LPT9')).toEqual({ valid: false, error: 'Reserved name' });
  });

  it('should reject names that are too long', () => {
    const longName = 'a'.repeat(256);
    expect(validateDbName(longName)).toEqual({ valid: false, error: 'Name too long (max 255 characters)' });

    // Exactly 255 should be valid
    const maxName = 'a'.repeat(255);
    expect(validateDbName(maxName)).toEqual({ valid: true });
  });

  it('should reject names with invalid characters', () => {
    expect(validateDbName('my@db')).toEqual({ valid: false, error: 'Name contains invalid characters' });
    expect(validateDbName('test#1')).toEqual({ valid: false, error: 'Name contains invalid characters' });
    expect(validateDbName('file*name')).toEqual({ valid: false, error: 'Name contains invalid characters' });
    expect(validateDbName('what?')).toEqual({ valid: false, error: 'Name contains invalid characters' });
    expect(validateDbName('<script>')).toEqual({ valid: false, error: 'Name contains invalid characters' });
  });
});

describe('sanitizeDbName', () => {
  it('should trim whitespace', () => {
    expect(sanitizeDbName('  mydb  ')).toBe('mydb');
    expect(sanitizeDbName('\tmydb\n')).toBe('mydb');
    expect(sanitizeDbName('mydb')).toBe('mydb');
  });

  it('should preserve internal spaces', () => {
    expect(sanitizeDbName('  my database  ')).toBe('my database');
  });
});

describe('isNameAvailable', () => {
  it('should return true for available names', () => {
    expect(isNameAvailable('newdb', ['existingdb', 'otherdb'])).toBe(true);
    expect(isNameAvailable('newdb', [])).toBe(true);
  });

  it('should return false for names that already exist', () => {
    expect(isNameAvailable('existingdb', ['existingdb', 'otherdb'])).toBe(false);
  });

  it('should be case-insensitive', () => {
    expect(isNameAvailable('MyDB', ['mydb', 'otherdb'])).toBe(false);
    expect(isNameAvailable('mydb', ['MYDB', 'otherdb'])).toBe(false);
  });

  it('should handle whitespace in input', () => {
    expect(isNameAvailable('  mydb  ', ['mydb', 'other'])).toBe(false);
  });
});
