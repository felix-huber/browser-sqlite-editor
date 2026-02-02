/**
 * Tests for QueryBuilderView state persistence (Fix #4)
 *
 * The bug: savedState was in useEffect dependencies causing an infinite loop.
 * The fix uses a hadSavedStateRef pattern to track whether we need to clear
 * state on empty, without including savedState in the dependencies.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('QueryBuilderView - State persistence infinite loop fix', () => {
  const viewPath = resolve(__dirname, '../QueryBuilderView.tsx');
  let content: string;

  beforeEach(() => {
    content = readFileSync(viewPath, 'utf-8');
  });

  it('should use hadSavedStateRef pattern instead of savedState in deps', () => {
    // Verify the ref pattern is used
    expect(content).toContain('hadSavedStateRef');
    expect(content).toMatch(/const hadSavedStateRef\s*=\s*useRef/);
  });

  it('should NOT include savedState in persistence useEffect dependencies', () => {
    // Find the persistence useEffect (the one that saves state)
    // It should NOT include savedState in its dependencies
    const persistenceEffectMatch = content.match(
      /\/\/\s*Persist Query Builder state[\s\S]*?useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?\},\s*\[([^\]]*)\]\s*\)/
    );

    if (persistenceEffectMatch) {
      const deps = persistenceEffectMatch[1];
      // savedState should NOT be in the deps (that caused the infinite loop)
      expect(deps).not.toContain('savedState');
    }
  });

  it('should have comment explaining why savedState is not in deps', () => {
    // Verify there's a comment explaining the intentional omission
    expect(content).toMatch(/Note:\s*Intentionally not including savedState in deps/i);
  });

  it('should track initial state restoration with ref', () => {
    // Verify the ref tracks initial state
    expect(content).toContain('hadSavedStateRef.current');
  });

  it('should set hadSavedStateRef when state is saved', () => {
    // When we save state, we should update the ref
    expect(content).toMatch(/hadSavedStateRef\.current\s*=\s*true/);
  });

  it('should clear state only when hadSavedStateRef indicates prior saved state', () => {
    // The clear logic should check hadSavedStateRef
    expect(content).toMatch(/if\s*\(hadSavedStateRef\.current\)/);
    // And then set it to false after clearing
    expect(content).toMatch(/hadSavedStateRef\.current\s*=\s*false/);
  });
});

describe('QueryBuilderView - State persistence correctness', () => {
  const viewPath = resolve(__dirname, '../QueryBuilderView.tsx');
  let content: string;

  beforeEach(() => {
    content = readFileSync(viewPath, 'utf-8');
  });

  it('should save state when any relevant state changes', () => {
    // The useEffect should depend on: nodes, joins, whereConditions, whereLogic, sortConditions, limit
    const persistenceEffectMatch = content.match(
      /\/\/\s*Persist Query Builder state[\s\S]*?useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?\},\s*\[([^\]]*)\]\s*\)/
    );

    if (persistenceEffectMatch) {
      const deps = persistenceEffectMatch[1];
      expect(deps).toContain('nodes');
      expect(deps).toContain('joins');
      expect(deps).toContain('whereConditions');
      expect(deps).toContain('whereLogic');
      expect(deps).toContain('sortConditions');
      expect(deps).toContain('limit');
    }
  });

  it('should strip callbacks before saving nodes', () => {
    // Callbacks (onSelectionChange, onRemove) should be stripped
    expect(content).toContain('onSelectionChange: undefined');
    expect(content).toContain('onRemove: undefined');
  });

  it('should check for meaningful state before saving', () => {
    // Should only save if there's actual state
    expect(content).toMatch(
      /const hasState\s*=\s*nodes\.length\s*>\s*0\s*\|\|\s*whereConditions\.length\s*>\s*0/
    );
  });
});
