/**
 * Tests for Vite configuration
 *
 * Verifies critical build settings to prevent production issues:
 * - Worker format must be 'es' to match { type: 'module' } in App.tsx
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// Read the vite.config.ts file content for inspection
// We test the config directly to catch regressions
const viteConfigPath = resolve(__dirname, '../../vite.config.ts');
const viteConfigContent = readFileSync(viteConfigPath, 'utf-8');

describe('Vite Config - Worker Format', () => {
  it('should have worker.format set to "es" for module workers', () => {
    // The worker format must be 'es' because App.tsx creates the worker with:
    // new Worker(url, { type: 'module' })
    // If format is 'iife' (default), it causes "Cannot use import statement" errors in production
    expect(viteConfigContent).toContain("format: 'es'");
  });

  it('should have worker configuration block', () => {
    expect(viteConfigContent).toContain('worker:');
  });

  it('should have comment explaining why format is es', () => {
    // Ensure there's a comment explaining the requirement for future maintainers
    expect(viteConfigContent).toMatch(/format:\s*['"]es['"]/);
    // Check for comment about module type
    expect(viteConfigContent).toMatch(/type:\s*['"]module['"]/i);
  });
});

describe('Vite Config - Base URL', () => {
  it('should support VITE_BASE environment variable for subdirectory deployments', () => {
    expect(viteConfigContent).toContain('VITE_BASE');
    expect(viteConfigContent).toContain("process.env.VITE_BASE || '/'");
  });

  it('should use base variable in config', () => {
    // The config defines 'const base = ...' and uses 'base,' in the config object
    expect(viteConfigContent).toContain('const base =');
    expect(viteConfigContent).toMatch(/defineConfig\(\{[\s\S]*?base,/);
  });
});
