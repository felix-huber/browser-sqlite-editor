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
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      // Disable overly strict React hooks rules from React 19 compiler plugin
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      // Allow control characters in regex (used for binary parsing)
      'no-control-regex': 'off',
      'prefer-const': 'warn',
    },
  },
  // Relaxed rules for test files
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-loss-of-precision': 'off',
    },
  }
);
