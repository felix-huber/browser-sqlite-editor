import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', '*.config.js', '*.config.ts', 'scripts/', 'tools/', 'prompts/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-empty-object-type': 'error',
      // Disable overly strict React hooks rules from React 19 compiler plugin
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/exhaustive-deps': 'error',
      // Allow control characters in regex (used for binary parsing)
      'no-control-regex': 'off',
      'prefer-const': 'error',
    },
  },
  // Relaxed rules for test files
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', 'e2e/**/*.ts'],
    rules: {
      'no-loss-of-precision': 'off',
    },
  }
);
