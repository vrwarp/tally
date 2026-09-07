import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    // `functions/src/generated` is a verbatim copy of files already linted at
    // their origin in `src/lib`; linting it again only double-reports.
    ignores: [
      'dist',
      'functions/lib',
      'functions/node_modules',
      'functions/src/generated',
      '.emulator-data',
      'coverage',
      /*
       * Stryker copies the whole project — `tsconfig.json` included — into a
       * sandbox per run. Left visible, typescript-eslint finds several
       * candidate roots and refuses to parse anything at all, so one mutation
       * run breaks `npm run lint` for everybody until the directory is
       * deleted. The reports beside it are generated too.
       */
      '.stryker-tmp',
      'reports',
      // `npm run typecheck` is `tsc -b --noEmit false`, so it leaves a .js
      // beside every .ts it checks. Linting the output as well as the source
      // reports every finding twice — and reports it against rules the
      // generated file cannot satisfy. Gitignored for the same reason.
      'src/**/*.js',
      'tests/**/*.js',
      'scripts/**/*.js',
      'firestore-tests/**/*.js',
      'e2e/**/*.js',
      'uxr/**/*.js',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Pinned to the two rules this project has always enforced. The plugin's
      // `recommended` set now also carries the React Compiler rules, which flag
      // existing hooks; adopting those is its own change, not a dependency bump.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Node-side code: scripts, config, Cloud Functions.
    files: ['scripts/**/*.ts', 'functions/src/**/*.ts', '*.config.ts', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    /*
     * Playwright code, not React. Its fixture signature is `async ({}, use)`,
     * which trips both the empty-pattern rule and the hooks rule — `use` is a
     * fixture callback, not a React hook.
     */
    files: ['e2e/**/*.ts', 'playwright.config.ts', 'uxr/**/*.ts'],
    // `uxr/` is the same shape: Node code that drives a browser, sharing the
    // e2e fixtures. `snapshot.ts` also runs a block inside the page, so it
    // needs the browser globals alongside Node's.
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'no-empty-pattern': 'off',
    },
  },
  {
    // `src/test/` is the suite's own helpers — Testing Library re-exported with
    // the app's IntlProvider wrapped around `render`. Never hot-reloaded, so the
    // react-refresh rule has nothing to say about it.
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.ts', 'src/test/**/*.{ts,tsx}', 'firestore-tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
);
