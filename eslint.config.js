import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // The project intentionally disables noUnusedLocals/Parameters in tsconfig
      // (large pre-existing codebase); mirror that leniency here as a warning
      // instead of a hard error so lint reflects real regressions, not legacy debt.
      '@typescript-eslint/no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      // Defensive `try { ... } catch {}` around optional/best-effort calls
      // (localStorage writes, chart API calls) is an established pattern here.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Flags legitimate "sync React state from an imperative external library"
      // effects (lightweight-charts) throughout TradingChart.tsx; worth revisiting
      // but not a today-regression, so keep it visible without failing lint.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
);
