import js from '@eslint/js';
import ts from 'typescript-eslint';
export default [
  { ignores: ['**/dist/**', 'fixtures/**', 'node_modules/**', 'packages/web/public/**'] },
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', URL: 'readonly', console: 'readonly' } },
  },
  ...ts.configs.recommended,
  { rules: { '@typescript-eslint/no-explicit-any': 'off' } },
];
